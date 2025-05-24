#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { parseLinksMarkdown, generateId, canonicalizeUrl } from './parseLinks.ts';

interface UrlToScrape {
  id: string;
  original_url: string;
  canonical_url: string;
}

interface ScrapedData {
  canonical_url: string;
  fetched_title?: string;
  main_text_content?: string;
  main_html_content?: string;
  publication_date?: string;
  author?: string;
  key_image_url?: string;
  local_image_path?: string;
  json_ld_objects?: any[];
  error?: string;
}

interface ScrapedArticle extends ScrapedData {
  id: string;
  original_url: string;
  scraping_timestamp: string;
  scraping_status: 'scraped' | 'error_scraping' | 'skipped';
}

class ContentScraper {
  private refreshOlderThan: Date | null = null;
  private existingData: Map<string, ScrapedArticle> = new Map();

  constructor(refreshOlderThan?: string) {
    if (refreshOlderThan) {
      this.refreshOlderThan = new Date(refreshOlderThan);
      console.log(`🔄 Refresh mode: will re-scrape articles older than ${this.refreshOlderThan.toISOString()}`);
    }
    
    this.loadExistingData();
  }

  private loadExistingData(): void {
    try {
      // Load from article directories in archive directory
      const scrapedDirs = ['archive'];
      let loadedCount = 0;
      
      for (const scrapedDir of scrapedDirs) {
        if (existsSync(scrapedDir)) {
          const articleDirs = require('fs').readdirSync(scrapedDir);
          for (const articleDir of articleDirs) {
            const articlePath = `${scrapedDir}/${articleDir}`;
            const dataFile = `${articlePath}/data.json`;
            
            // Check if it's a directory and has data.json
            if (require('fs').statSync(articlePath).isDirectory() && existsSync(dataFile)) {
              try {
                const article: ScrapedArticle = JSON.parse(readFileSync(dataFile, 'utf-8'));
                if (!this.existingData.has(article.id)) {
                  this.existingData.set(article.id, article);
                  loadedCount++;
                }
              } catch (error) {
                console.warn(`⚠️  Could not load ${dataFile}:`, error);
              }
            }
            // Also handle old format (direct JSON files) for backward compatibility
            else if (articleDir.endsWith('.json')) {
              try {
                const article: ScrapedArticle = JSON.parse(readFileSync(articlePath, 'utf-8'));
                if (!this.existingData.has(article.id)) {
                  this.existingData.set(article.id, article);
                  loadedCount++;
                }
              } catch (error) {
                console.warn(`⚠️  Could not load ${articlePath}:`, error);
              }
            }
          }
        }
      }
      
      if (loadedCount > 0) {
        console.log(`📚 Loaded ${loadedCount} existing scraped articles from archive`);
      }
    } catch (error) {
      console.warn('Could not load existing scraped data:', error);
    }
  }

  private shouldScrapeArticle(link: UrlToScrape): boolean {
    const existing = this.existingData.get(link.id);
    
    // Never overwrite resurrected articles
    if (existing && (existing as any).resurrected) {
      console.log(`⚡ Skipping resurrected article: ${link.canonical_url}`);
      return false;
    }
    
    // If no existing data, scrape it
    if (!existing) {
      return true;
    }
    
    // If we have a refresh date and existing data is older, scrape it
    if (this.refreshOlderThan && existing.scraping_timestamp) {
      const scrapingDate = new Date(existing.scraping_timestamp);
      if (scrapingDate < this.refreshOlderThan) {
        return true;
      }
    }
    
    // If existing data has an error, try again
    if (existing.scraping_status === 'error_scraping') {
      return true;
    }
    
    // Otherwise, skip scraping
    return false;
  }

  private parseLinksMarkdown(): UrlToScrape[] {
    try {
      const content = readFileSync('links.md', 'utf-8');
      const lines = content.split('\n');
      const links: UrlToScrape[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip empty lines, headers, and non-list items
        if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('-')) {
          continue;
        }

        // Extract URL from markdown link format or plain URL
        let url = '';

        // Match [title](url) format
        const linkMatch = trimmed.match(/\[([^\]]*)\]\(([^)]+)\)/);
        if (linkMatch && linkMatch[1] !== undefined && linkMatch[2] !== undefined) {
          url = linkMatch[2];
        } else {
          // Match plain URL
          const urlMatch = trimmed.match(/https?:\/\/[^\s#@]+/);
          if (urlMatch && urlMatch[0] !== undefined) {
            url = urlMatch[0];
          }
        }

        if (!url) continue;

        const canonical_url = canonicalizeUrl(url);
        const id = generateId(canonical_url);

        links.push({
          id,
          original_url: url,
          canonical_url
        });
      }

      console.log(`Parsed ${links.length} URLs from links.md`);
      return links;
    } catch (error) {
      console.error('Error parsing links.md:', error);
      return [];
    }
  }

  private async downloadImage(imageUrl: string, articleId: string): Promise<string | undefined> {
    try {
      console.log(`📸 Downloading image: ${imageUrl}`);
      
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 second timeout
      
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkHarbor/1.0; +https://github.com/your-username/linkharbor)'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`Failed to download image: HTTP ${response.status}`);
        return undefined;
      }

      // Get file extension from URL or content type
      const contentType = response.headers.get('content-type');
      let extension = '.jpg'; // default
      
      if (contentType?.includes('png')) extension = '.png';
      else if (contentType?.includes('gif')) extension = '.gif';
      else if (contentType?.includes('webp')) extension = '.webp';
      else if (contentType?.includes('svg')) extension = '.svg';
      else {
        // Try to get extension from URL
        const urlExtension = imageUrl.split('.').pop()?.toLowerCase();
        if (urlExtension && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(urlExtension)) {
          extension = '.' + urlExtension;
        }
      }

      // Save to temporary directory first
      const tempDir = `archive/${articleId}.tmp`;
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }

      // Save image in temporary directory
      const filename = `image${extension}`;
      const filepath = `${tempDir}/${filename}`;
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      
      writeFileSync(filepath, buffer);
      
      console.log(`✅ Image saved to temp: ${filepath}`);
      return `archive/${articleId}/${filename}`; // Return relative path for web use
      
    } catch (error) {
      let errorMessage = 'Unknown error';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Download timed out after 4 seconds';
        } else {
          errorMessage = error.message;
        }
      }
      
      console.warn(`Failed to download image ${imageUrl}: ${errorMessage}`);
      return undefined;
    }
  }

  private async generatePDF(url: string, articleId: string): Promise<string | undefined> {
    try {
      console.log(`📄 Generating PDF for: ${url}`);
      
      // Save to temporary directory first
      const tempDir = `archive/${articleId}.tmp`;
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      
      const pdfPath = `${tempDir}/archive.pdf`;
      
      // Wrap the entire PDF generation in a global timeout to prevent hanging
      const pdfResult = await Promise.race([
        this.tryAllPDFMethods(url, pdfPath, articleId),
        new Promise<string | undefined>((_, reject) => 
          setTimeout(() => reject(new Error('PDF generation global timeout (60s)')), 60000)
        )
      ]);
      
      return pdfResult;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`⚠️  PDF generation completely failed for ${url}: ${errorMessage}`);
      return undefined;
    }
  }

  private async tryAllPDFMethods(url: string, pdfPath: string, articleId: string): Promise<string | undefined> {
    // Try multiple approaches in order of preference
    
    // 1. Try using Playwright (more reliable than Puppeteer)
    try {
      const success = await this.generatePDFWithPlaywright(url, pdfPath, articleId);
      if (success) {
        console.log(`✅ PDF saved (Playwright): ${pdfPath}`);
        return pdfPath;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`⚠️  Playwright PDF generation failed: ${errorMessage}`);
    }
    
    // 2. Try Chrome/Chromium from common paths
    try {
      const chromeSuccess = await this.tryChromePDF(url, pdfPath, articleId);
      if (chromeSuccess) {
        console.log(`✅ PDF saved (Chrome): ${pdfPath}`);
        return pdfPath;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`⚠️  Chrome PDF generation failed: ${errorMessage}`);
    }
    
    // 3. Try wkhtmltopdf as fallback
    try {
      const wkSuccess = await this.tryAlternativePDF(url, pdfPath, articleId);
      if (wkSuccess) {
        console.log(`✅ PDF saved (wkhtmltopdf): ${pdfPath}`);
        return pdfPath;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`⚠️  wkhtmltopdf PDF generation failed: ${errorMessage}`);
    }
    
    // 4. Create a simple HTML-to-PDF fallback using basic HTML
    try {
      const htmlSuccess = await this.createSimplePDF(url, articleId, pdfPath);
      if (htmlSuccess) {
        console.log(`✅ PDF saved (HTML fallback): ${pdfPath}`);
        return pdfPath;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`⚠️  HTML fallback PDF generation failed: ${errorMessage}`);
    }
    
    console.warn(`⚠️  Could not generate PDF for ${url} - all PDF tools failed`);
    return undefined;
  }

  private async generatePDFWithPlaywright(url: string, pdfPath: string, articleId: string): Promise<boolean> {
    let browser: any = null;
    let page: any = null;
    
    try {
      // Try to use Playwright if available (more reliable than Puppeteer)
      const playwright = await import('playwright').catch(() => null);
      if (!playwright) {
        return false;
      }
      
      // Add timeout and better error handling for browser launch
      browser = await Promise.race([
        playwright.chromium.launch({
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
          ]
        }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Browser launch timeout')), 8000)
        )
      ]);
      
      page = await browser.newPage();
      
      // Set a shorter timeout for navigation to prevent hanging
      await Promise.race([
        page.goto(url, { 
          waitUntil: 'domcontentloaded', // Less strict than 'networkidle'
          timeout: 15000 // Reduced from 30000
        }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Page navigation timeout')), 20000)
        )
      ]);
      
      // Wait a bit for dynamic content but don't wait too long
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Add timeout for PDF generation
      await Promise.race([
        page.pdf({
          path: pdfPath,
          format: 'Letter',
          printBackground: true,
          margin: {
            top: '1cm',
            right: '1cm',
            bottom: '1cm',
            left: '1cm'
          }
        }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('PDF generation timeout')), 10000)
        )
      ]);
      
      // Close page first, then browser
      if (page) {
        await page.close();
        page = null;
      }
      
      if (browser) {
        await browser.close();
        browser = null;
      }
      
      return existsSync(pdfPath);
      
    } catch (error) {
      // Log the specific error for debugging but don't crash
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`⚠️  Playwright PDF failed: ${errorMessage}`);
      
      // Ensure page and browser are closed even on error
      try {
        if (page) {
          await page.close();
        }
      } catch (closeError) {
        // Ignore close errors
      }
      
      try {
        if (browser) {
          await browser.close();
        }
      } catch (closeError) {
        // Ignore close errors
      }
      
      return false;
    }
  }

  private async tryChromePDF(url: string, pdfPath: string, articleId: string): Promise<boolean> {
    const { spawn } = require('child_process');
    
    // Try different Chrome/Chromium executable names and paths
    const chromeCommands = [
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    
    for (const chromeCmd of chromeCommands) {
      try {
        const success = await new Promise<boolean>((resolve) => {
          const chrome = spawn(chromeCmd, [
            '--headless',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--print-to-pdf=' + pdfPath,
            '--print-to-pdf-no-header',
            '--virtual-time-budget=10000',
            url
          ], {
            stdio: 'pipe'
          });
          
          chrome.on('close', (code: number) => {
            resolve(code === 0 && existsSync(pdfPath));
          });
          
          chrome.on('error', () => {
            resolve(false);
          });
          
          // Timeout after 30 seconds
          setTimeout(() => {
            chrome.kill();
            resolve(false);
          }, 30000);
        });
        
        if (success) {
          return true;
        }
      } catch (error) {
        // Continue to next Chrome command
        continue;
      }
    }
    
    return false;
  }

  private async createSimplePDF(url: string, articleId: string, pdfPath: string): Promise<boolean> {
    try {
      // As a last resort, create a simple text-based PDF using the scraped content
      // This is a fallback when no PDF tools are available
      
      // Get the scraped data for this article from temp directory first, then final directory
      const tempDir = `archive/${articleId}.tmp`;
      const finalDir = `archive/${articleId}`;
      
      let articleData = null;
      let dataFile = `${tempDir}/data.json`;
      
      if (!existsSync(dataFile)) {
        dataFile = `${finalDir}/data.json`;
      }
      
      if (!existsSync(dataFile)) {
        return false;
      }
      
      articleData = JSON.parse(readFileSync(dataFile, 'utf-8'));
      
      // Create a simple HTML document
      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${articleData.fetched_title || 'Article'}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        h1 { color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
        .meta { color: #666; font-size: 0.9em; margin-bottom: 20px; }
        .content { margin-top: 20px; }
        .url { color: #0066cc; word-break: break-all; }
    </style>
</head>
<body>
    <h1>${articleData.fetched_title || 'Article'}</h1>
    <div class="meta">
        <p><strong>URL:</strong> <span class="url">${url}</span></p>
        ${articleData.author ? `<p><strong>Author:</strong> ${articleData.author}</p>` : ''}
        ${articleData.publication_date ? `<p><strong>Published:</strong> ${articleData.publication_date}</p>` : ''}
        <p><strong>Scraped:</strong> ${new Date().toISOString()}</p>
    </div>
    <div class="content">
        ${articleData.main_text_content ? `<p>${articleData.main_text_content.replace(/\n/g, '</p><p>')}</p>` : '<p>Content not available</p>'}
    </div>
</body>
</html>`;
      
      // Save as HTML file in the same temp directory as the PDF
      const htmlPath = pdfPath.replace('.pdf', '.html');
      writeFileSync(htmlPath, htmlContent);
      
      // Try to use any available HTML-to-PDF tool
      const { spawn } = require('child_process');
      
      // Try Prince XML if available
      try {
        const success = await new Promise<boolean>((resolve) => {
          const prince = spawn('prince', [htmlPath, '-o', pdfPath], { stdio: 'pipe' });
          prince.on('close', (code: number) => resolve(code === 0 && existsSync(pdfPath)));
          prince.on('error', () => resolve(false));
          setTimeout(() => { prince.kill(); resolve(false); }, 10000);
        });
        if (success) return true;
      } catch (error) {
        // Prince not available
      }
      
      // If no PDF tools available, just keep the HTML file as archive
      console.log(`📄 Created HTML archive instead: ${htmlPath}`);
      return existsSync(htmlPath);
      
    } catch (error) {
      return false;
    }
  }

  private async tryAlternativePDF(url: string, pdfPath: string, articleId: string): Promise<boolean> {
    try {
      const { spawn } = require('child_process');
      
      return new Promise((resolve) => {
        const wkhtmltopdf = spawn('wkhtmltopdf', [
          '--page-size', 'A4',
          '--margin-top', '0.75in',
          '--margin-right', '0.75in',
          '--margin-bottom', '0.75in',
          '--margin-left', '0.75in',
          '--encoding', 'UTF-8',
          '--quiet',
          url,
          pdfPath
        ], {
          stdio: 'pipe'
        });
        
        wkhtmltopdf.on('close', (code: number) => {
          resolve(code === 0 && existsSync(pdfPath));
        });
        
        wkhtmltopdf.on('error', () => {
          resolve(false);
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
          wkhtmltopdf.kill();
          resolve(false);
        }, 30000);
      });
    } catch (error) {
      return false;
    }
  }

  private async scrapeUrl(url: string, articleId: string): Promise<ScrapedData> {
    try {
      console.log(`🌐 Scraping: ${url}`);
      
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 second timeout
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkHarbor/1.0; +https://github.com/your-username/linkharbor)'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const canonical_url = response.url; // Follow redirects

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const fetched_title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : undefined;

      // Extract meta description
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      const description = descMatch && descMatch[1] ? descMatch[1] : '';

      // Extract publication date from various sources
      let publication_date: string | undefined;
      
      // Try meta property="article:published_time"
      const articleDateMatch = html.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i);
      if (articleDateMatch && articleDateMatch[1]) {
        publication_date = articleDateMatch[1];
      } else {
        // Try meta name="date"
        const dateMatch = html.match(/<meta[^>]*name=["']date["'][^>]*content=["']([^"']+)["']/i);
        if (dateMatch && dateMatch[1]) {
          publication_date = dateMatch[1];
        }
      }

      // Extract author
      let author: string | undefined;
      const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i);
      if (authorMatch && authorMatch[1]) {
        author = authorMatch[1];
      } else {
        // Try article:author
        const articleAuthorMatch = html.match(/<meta[^>]*property=["']article:author["'][^>]*content=["']([^"']+)["']/i);
        if (articleAuthorMatch && articleAuthorMatch[1]) {
          author = articleAuthorMatch[1];
        }
      }

      // Simple content extraction
      let main_text_content = description;
      let main_html_content = '';
      
      // Try to extract main content from common patterns
      const contentPatterns = [
        /<article[^>]*>(.*?)<\/article>/is,
        /<main[^>]*>(.*?)<\/main>/is,
        /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>(.*?)<\/div>/is,
        /<div[^>]*class=["'][^"']*post[^"']*["'][^>]*>(.*?)<\/div>/is,
        /<div[^>]*class=["'][^"']*recipe[^"']*["'][^>]*>(.*?)<\/div>/is
      ];

      for (const pattern of contentPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          main_html_content = match[1].trim();
          // Strip HTML tags for text content
          const textContent = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (textContent.length > main_text_content.length) {
            main_text_content = textContent;
          }
          break;
        }
      }
      
      // If no main content found, use the full HTML
      if (!main_html_content) {
        main_html_content = html;
      }

      // Extract JSON-LD data
      const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
      const json_ld_objects: any[] = [];
      
      for (const match of jsonLdMatches) {
        if (match[1]) {
          try {
            const jsonData = JSON.parse(match[1]);
            json_ld_objects.push(jsonData);
          } catch {
            // Ignore invalid JSON-LD
          }
        }
      }

      // Extract key image (og:image or first img)
      const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
      let key_image_url = ogImageMatch && ogImageMatch[1] ? ogImageMatch[1] : undefined;

      if (!key_image_url) {
        const imgMatch = html.match(/<img[^>]*src=["']([^"']+)["']/i);
        key_image_url = imgMatch && imgMatch[1] ? imgMatch[1] : undefined;
      }

      // Make relative URLs absolute
      if (key_image_url && !key_image_url.startsWith('http')) {
        try {
          const baseUrl = new URL(canonical_url);
          key_image_url = new URL(key_image_url, baseUrl.origin).toString();
        } catch {
          // Ignore invalid URLs
        }
      }

      // Download and save key image locally
      let local_image_path: string | undefined;
      if (key_image_url) {
        local_image_path = await this.downloadImage(key_image_url, articleId);
      }

      // Generate PDF archive (don't let PDF failures crash the scraping)
      // try {
      //   await this.generatePDF(canonical_url, articleId);
      // } catch (error) {
      //   const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      //   console.warn(`⚠️  PDF generation failed for ${canonical_url}: ${errorMessage}`);
      //   // Continue with scraping even if PDF fails
      // }

      return {
        canonical_url,
        fetched_title,
        main_text_content: main_text_content ? main_text_content.substring(0, 5000) : undefined,
        main_html_content: main_html_content ? main_html_content.substring(0, 50000) : undefined, // Keep more HTML
        publication_date,
        author,
        key_image_url,
        local_image_path,
        json_ld_objects: json_ld_objects.length > 0 ? json_ld_objects : undefined
      };

    } catch (error) {
      let errorMessage = 'Unknown error';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timed out after 4 seconds';
        } else {
          errorMessage = error.message;
        }
      }
      
      console.error(`❌ Error scraping ${url}:`, errorMessage);
      return {
        canonical_url: url,
        error: errorMessage
      };
    }
  }

  private async scrapeLink(link: UrlToScrape): Promise<ScrapedArticle> {
    console.log(`🔄 Processing: ${link.canonical_url}`);

    // Scrape content
    const scrapedData = await this.scrapeUrl(link.canonical_url, link.id);
    
    if (scrapedData.error) {
      return {
        id: link.id,
        original_url: link.original_url,
        ...scrapedData,
        scraping_timestamp: new Date().toISOString(),
        scraping_status: 'error_scraping'
      };
    }

    return {
      id: link.id,
      original_url: link.original_url,
      ...scrapedData,
      scraping_timestamp: new Date().toISOString(),
      scraping_status: 'scraped'
    };
  }

  private async saveScrapedArticleAtomically(article: ScrapedArticle, scrapedDir: string): Promise<void> {
    const articleDir = `${scrapedDir}/${article.id}`;
    const tempDir = `${articleDir}.tmp`;
    
    try {
      // Create temporary directory if it doesn't exist
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      
      // Save JSON data to temporary directory
      const tempDataFile = `${tempDir}/data.json`;
      writeFileSync(tempDataFile, JSON.stringify(article, null, 2));
      
      // Save raw HTML if available
      if (article.main_html_content) {
        const tempHtmlFile = `${tempDir}/content.html`;
        writeFileSync(tempHtmlFile, article.main_html_content);
      }
      
      // At this point, any images/PDFs should already be in the temp directory
      // from the scraping process (downloadImage and generatePDF methods)
      
      // Now atomically move the temporary directory to the final location
      if (existsSync(articleDir)) {
        // Remove existing directory first
        require('fs').rmSync(articleDir, { recursive: true, force: true });
      }
      
      // Rename temp directory to final directory (atomic operation on most filesystems)
      require('fs').renameSync(tempDir, articleDir);
      
      console.log(`💾 Atomically saved article data to ${articleDir}`);
      
    } catch (error) {
      // Clean up temp directory if something went wrong
      if (existsSync(tempDir)) {
        try {
          require('fs').rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn(`Failed to cleanup temp directory ${tempDir}:`, cleanupError);
        }
      }
      throw error;
    }
  }

  async scrapeAllLinks(): Promise<void> {
    const links = this.parseLinksMarkdown();
    
    if (links.length === 0) {
      console.log('No links found to scrape');
      return;
    }

    // Create output directories in new data structure
    const scrapedDir = 'archive';
    if (!existsSync(scrapedDir)) {
      mkdirSync(scrapedDir, { recursive: true });
    }

    // Filter links that need scraping
    const linksToScrape = links.filter(link => this.shouldScrapeArticle(link));
    const skippedCount = links.length - linksToScrape.length;
    
    console.log(`📊 Scraping status:`);
    console.log(`  Total links: ${links.length}`);
    console.log(`  Already scraped: ${skippedCount}`);
    console.log(`  Need scraping: ${linksToScrape.length}`);

    let scrapedCount = 0;
    let errorCount = 0;

    // Scrape links with incremental saving
    for (let i = 0; i < linksToScrape.length; i++) {
      const link = linksToScrape[i];
      if (!link) continue;
      
      try {
        console.log(`\n🌐 Scraping ${i + 1}/${linksToScrape.length}: ${link.canonical_url}`);
        
        const scraped = await this.scrapeLink(link);
        
        // Use atomic write to prevent partial data from being saved
        await this.saveScrapedArticleAtomically(scraped, scrapedDir);
        
        // Update in-memory cache only after successful save
        this.existingData.set(scraped.id, scraped);
        
        if (scraped.scraping_status === 'scraped') {
          scrapedCount++;
          console.log(`✅ Success: ${scraped.fetched_title || 'Untitled'}`);
        } else {
          errorCount++;
          console.log(`❌ Error: ${scraped.scraping_status} - ${scraped.error || 'Unknown error'}`);
        }
        
        // Add delay between requests (be respectful)
        if (i < linksToScrape.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`💥 Failed to scrape ${link.canonical_url}:`, error);
        const errorArticle: ScrapedArticle = {
          ...link,
          scraping_timestamp: new Date().toISOString(),
          scraping_status: 'error_scraping',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        // Save error atomically too
        try {
          await this.saveScrapedArticleAtomically(errorArticle, scrapedDir);
          this.existingData.set(errorArticle.id, errorArticle);
        } catch (saveError) {
          console.error(`💥 Failed to save error data for ${link.canonical_url}:`, saveError);
        }
        errorCount++;
      }
    }

    // All data is already saved as individual files in archive/
    const allArticles = Array.from(this.existingData.values());

    console.log(`\n🎉 Scraping complete!`);
    console.log(`📊 Final statistics:`);
    console.log(`  Total articles: ${allArticles.length}`);
    console.log(`  Successfully scraped: ${allArticles.filter(a => a.scraping_status === 'scraped').length}`);
    console.log(`  Errors: ${allArticles.filter(a => a.scraping_status === 'error_scraping').length}`);
    console.log(`  This session: +${scrapedCount} scraped, ${errorCount} errors`);
  }
}

// Main execution
async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let refreshOlderThan: string | undefined;
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--refresh-older-than' && args[i + 1]) {
        refreshOlderThan = args[i + 1];
        i++; // Skip the next argument since we consumed it
      }
    }
    
    const scraper = new ContentScraper(refreshOlderThan);
    await scraper.scrapeAllLinks();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
} 