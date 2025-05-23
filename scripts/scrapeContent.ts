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
  private refreshSince: Date | null = null;
  private existingData: Map<string, ScrapedArticle> = new Map();

  constructor(refreshSince?: string) {
    if (refreshSince) {
      this.refreshSince = new Date(refreshSince);
      console.log(`🔄 Refresh mode: will re-scrape articles since ${this.refreshSince.toISOString()}`);
    }
    
    this.loadExistingData();
  }

  private loadExistingData(): void {
    try {
      // Load from article directories in scraped directories
      const scrapedDirs = ['build_output/data/scraped', 'build_output/scraped'];
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
        console.log(`📚 Loaded ${loadedCount} existing scraped articles from individual files`);
      }
    } catch (error) {
      console.warn('Could not load existing scraped data:', error);
    }
  }

  private shouldScrapeArticle(link: UrlToScrape): boolean {
    const existing = this.existingData.get(link.id);
    
    if (!existing) {
      return true; // New article, always scrape
    }

    if (this.refreshSince) {
      const lastScraped = new Date(existing.scraping_timestamp);
      return lastScraped < this.refreshSince;
    }

    // Don't re-scrape if we have good data
    return existing.scraping_status !== 'scraped';
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

      // Create article directory
      const articleDir = `build_output/data/scraped/${articleId}`;
      if (!existsSync(articleDir)) {
        mkdirSync(articleDir, { recursive: true });
      }

      // Save image in article directory
      const filename = `image${extension}`;
      const filepath = `${articleDir}/${filename}`;
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      
      writeFileSync(filepath, buffer);
      
      console.log(`✅ Image saved: ${filepath}`);
      return `scraped/${articleId}/${filename}`; // Return relative path for web use
      
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

  async scrapeAllLinks(): Promise<void> {
    const links = this.parseLinksMarkdown();
    
    if (links.length === 0) {
      console.log('No links found to scrape');
      return;
    }

    // Create output directories in new data structure
    const scrapedDir = 'build_output/data/scraped';
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
        
        // Create article directory
        const articleDir = `${scrapedDir}/${scraped.id}`;
        if (!existsSync(articleDir)) {
          mkdirSync(articleDir, { recursive: true });
        }
        
        // Save JSON data
        writeFileSync(
          `${articleDir}/data.json`,
          JSON.stringify(scraped, null, 2)
        );
        
        // Save raw HTML if available
        if (scraped.main_html_content) {
          writeFileSync(
            `${articleDir}/content.html`,
            scraped.main_html_content
          );
        }
        
        // Update in-memory cache
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
        
        // Save error immediately too
        const errorArticleDir = `${scrapedDir}/${errorArticle.id}`;
        if (!existsSync(errorArticleDir)) {
          mkdirSync(errorArticleDir, { recursive: true });
        }
        writeFileSync(
          `${errorArticleDir}/data.json`,
          JSON.stringify(errorArticle, null, 2)
        );
        
        this.existingData.set(errorArticle.id, errorArticle);
        errorCount++;
      }
    }

    // All data is already saved as individual files in build_output/data/scraped/
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
    let refreshSince: string | undefined;
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--refresh-since' && args[i + 1]) {
        refreshSince = args[i + 1];
        i++; // Skip the next argument since we consumed it
      }
    }
    
    const scraper = new ContentScraper(refreshSince);
    await scraper.scrapeAllLinks();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
} 