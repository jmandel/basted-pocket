#!/usr/bin/env bun

import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';

interface TagDefinition {
  name: string;
  description: string;
  keywords_hint?: string[];
}

interface TagDefinitions {
  tags: TagDefinition[];
}

interface ParsedLink {
  id: string;
  original_url: string;
  canonical_url: string;
  user_title?: string;
  user_tags: string[];
  user_notes?: string;
  time_added_to_links_md?: string;
}

interface ScrapedData {
  canonical_url: string;
  fetched_title?: string;
  main_text_content?: string;
  main_html_content?: string;
  publication_date?: string;
  author?: string;
  key_image_url?: string;
  json_ld_objects?: any[];
  error?: string;
}

interface EnrichedData {
  auto_tags?: string[];
  summary?: string;
  keywords?: string[];
  read_time_minutes?: number;
  content_type?: string;
  llm_error?: string;
}

interface ProcessedArticle extends ParsedLink, ScrapedData, EnrichedData {
  processing_timestamp: string;
  status: 'processed' | 'error_scraping' | 'error_llm' | 'skipped';
}

class LinkProcessor {
  private gemini: GoogleGenAI;
  private tagDefinitions: TagDefinitions;
  private refreshSince: Date | null = null;
  private existingData: Map<string, ProcessedArticle> = new Map();

  constructor(refreshSince?: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    
    this.gemini = new GoogleGenAI({ apiKey });
    this.tagDefinitions = this.loadTagDefinitions();
    
    if (refreshSince) {
      this.refreshSince = new Date(refreshSince);
      console.log(`🔄 Refresh mode: will re-process articles since ${this.refreshSince.toISOString()}`);
    }
    
    this.loadExistingData();
  }

  private loadTagDefinitions(): TagDefinitions {
    try {
      const content = readFileSync('config/tags.json', 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.warn('Could not load tag definitions, using defaults');
      return {
        tags: [
          { name: 'general', description: 'General content' }
        ]
      };
    }
  }

  private loadExistingData(): void {
    try {
      // Load from consolidated file first
      if (existsSync('build_output/all_articles_data.json')) {
        const data: ProcessedArticle[] = JSON.parse(readFileSync('build_output/all_articles_data.json', 'utf-8'));
        for (const article of data) {
          this.existingData.set(article.id, article);
        }
        console.log(`📚 Loaded ${data.length} existing articles from cache`);
      }

      // Also check individual files in case of partial processing
      if (existsSync('build_output/articles')) {
        const files = require('fs').readdirSync('build_output/articles');
        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              const article: ProcessedArticle = JSON.parse(readFileSync(`build_output/articles/${file}`, 'utf-8'));
              if (!this.existingData.has(article.id)) {
                this.existingData.set(article.id, article);
              }
            } catch (error) {
              console.warn(`⚠️  Could not load ${file}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Could not load existing data:', error);
    }
  }

  private shouldProcessArticle(link: ParsedLink): boolean {
    const existing = this.existingData.get(link.id);
    
    if (!existing) {
      return true; // New article, always process
    }

    if (this.refreshSince) {
      const lastProcessed = new Date(existing.processing_timestamp);
      return lastProcessed < this.refreshSince;
    }

    // Don't re-process if we have good data
    return existing.status !== 'processed';
  }

  private generateId(url: string): string {
    return createHash('sha256').update(url).digest('hex').substring(0, 16);
  }

  private parseLinksMarkdown(): ParsedLink[] {
    try {
      const content = readFileSync('links.md', 'utf-8');
      const lines = content.split('\n');
      const links: ParsedLink[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip empty lines, headers, and non-list items
        if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('-')) {
          continue;
        }

        // Extract URL from markdown link format or plain URL
        let url = '';
        let title = '';
        const tags: string[] = [];
        let notes = '';

        // Match [title](url) format
        const linkMatch = trimmed.match(/\[([^\]]*)\]\(([^)]+)\)/);
        if (linkMatch && linkMatch[1] !== undefined && linkMatch[2] !== undefined) {
          title = linkMatch[1];
          url = linkMatch[2];
        } else {
          // Match plain URL
          const urlMatch = trimmed.match(/https?:\/\/[^\s#@]+/);
          if (urlMatch && urlMatch[0] !== undefined) {
            url = urlMatch[0];
          }
        }

        if (!url) continue;

        // Extract tags (#tag)
        const tagMatches = trimmed.matchAll(/#(\w+)/g);
        for (const match of tagMatches) {
          if (match[1] !== undefined) {
            tags.push(match[1]);
          }
        }

        // Extract notes (@note:text)
        const noteMatch = trimmed.match(/@note:([^#]*)/);
        if (noteMatch && noteMatch[1] !== undefined) {
          notes = noteMatch[1].trim();
        }

        const canonical_url = this.canonicalizeUrl(url);
        const id = this.generateId(canonical_url);

        links.push({
          id,
          original_url: url,
          canonical_url,
          user_title: title || undefined,
          user_tags: tags,
          user_notes: notes || undefined
        });
      }

      console.log(`Parsed ${links.length} links from links.md`);
      return links;
    } catch (error) {
      console.error('Error parsing links.md:', error);
      return [];
    }
  }

  private canonicalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove common tracking parameters
      const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
      paramsToRemove.forEach(param => parsed.searchParams.delete(param));
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private async scrapeUrl(url: string): Promise<ScrapedData> {
    try {
      console.log(`Scraping: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkHarbor/1.0; +https://github.com/your-username/linkharbor)'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const canonical_url = response.url; // Follow redirects

      // Basic HTML parsing for title and content
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const fetched_title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : undefined;

      // Extract meta description as a fallback for content
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      const description = descMatch && descMatch[1] ? descMatch[1] : '';

      // Simple content extraction (this could be enhanced with a proper library)
      let main_text_content = description;
      
      // Try to extract main content from common patterns
      const contentPatterns = [
        /<article[^>]*>(.*?)<\/article>/is,
        /<main[^>]*>(.*?)<\/main>/is,
        /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>(.*?)<\/div>/is,
        /<div[^>]*class=["'][^"']*post[^"']*["'][^>]*>(.*?)<\/div>/is
      ];

      for (const pattern of contentPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          // Strip HTML tags for text content
          const textContent = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (textContent.length > main_text_content.length) {
            main_text_content = textContent;
          }
          break;
        }
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

      return {
        canonical_url,
        fetched_title,
        main_text_content: main_text_content ? main_text_content.substring(0, 5000) : undefined, // Limit for LLM processing
        key_image_url,
        json_ld_objects: json_ld_objects.length > 0 ? json_ld_objects : undefined
      };

    } catch (error) {
      console.error(`Error scraping ${url}:`, error);
      return {
        canonical_url: url,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async enrichWithGemini(textContent: string): Promise<EnrichedData> {
    try {
      if (!textContent || textContent.length < 50) {
        return { llm_error: 'Content too short for LLM processing' };
      }

      // Auto-tagging
      const tagPrompt = `Based on the following article text and available tags, assign the most relevant tags (up to 3) from the provided list. Only use tags from this list.

Available Tags:
${JSON.stringify(this.tagDefinitions.tags.map(t => ({ name: t.name, description: t.description })))}

Article Text:
"""
${textContent.substring(0, 2000)}
"""

Return a JSON object with this structure:
{
  "tags": ["tag1", "tag2"],
  "summary": "A concise 2-3 sentence summary of the article",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "content_type": "article|blog|tutorial|news|recipe|other"
}`;

      const response = await this.gemini.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: tagPrompt,
        config: { responseMimeType: 'application/json' }
      });
      const responseText = response.text || '{}';
      const parsed = JSON.parse(responseText);

      // Calculate read time (average 200 words per minute)
      const wordCount = textContent.split(/\s+/).length;
      const read_time_minutes = Math.max(1, Math.round(wordCount / 200));

      return {
        auto_tags: parsed.tags || [],
        summary: parsed.summary || '',
        keywords: parsed.keywords || [],
        content_type: parsed.content_type || 'article',
        read_time_minutes
      };

    } catch (error) {
      console.error('Error with Gemini enrichment:', error);
      return {
        llm_error: error instanceof Error ? error.message : 'Unknown LLM error'
      };
    }
  }

  private async processLink(link: ParsedLink): Promise<ProcessedArticle> {
    console.log(`Processing: ${link.canonical_url}`);

    // Scrape content
    const scrapedData = await this.scrapeUrl(link.canonical_url);
    
    if (scrapedData.error) {
      return {
        ...link,
        ...scrapedData,
        processing_timestamp: new Date().toISOString(),
        status: 'error_scraping'
      };
    }

    // Enrich with LLM
    let enrichedData: EnrichedData = {};
    if (scrapedData.main_text_content) {
      enrichedData = await this.enrichWithGemini(scrapedData.main_text_content);
    }

    return {
      ...link,
      ...scrapedData,
      ...enrichedData,
      processing_timestamp: new Date().toISOString(),
      status: enrichedData.llm_error ? 'error_llm' : 'processed'
    };
  }

  async processAllLinks(): Promise<void> {
    const links = this.parseLinksMarkdown();
    
    if (links.length === 0) {
      console.log('No links found to process');
      return;
    }

    // Create output directories
    if (!existsSync('build_output')) {
      mkdirSync('build_output', { recursive: true });
    }
    const articlesDir = 'build_output/articles';
    if (!existsSync(articlesDir)) {
      mkdirSync(articlesDir, { recursive: true });
    }

    // Filter links that need processing
    const linksToProcess = links.filter(link => this.shouldProcessArticle(link));
    const skippedCount = links.length - linksToProcess.length;
    
    console.log(`📊 Processing status:`);
    console.log(`  Total links: ${links.length}`);
    console.log(`  Already processed: ${skippedCount}`);
    console.log(`  Need processing: ${linksToProcess.length}`);

    let processedCount = 0;
    let errorCount = 0;

    // Process links with incremental saving
    for (let i = 0; i < linksToProcess.length; i++) {
      const link = linksToProcess[i];
      if (!link) continue;
      
      try {
        console.log(`\n🔄 Processing ${i + 1}/${linksToProcess.length}: ${link.canonical_url}`);
        
        const processed = await this.processLink(link);
        
        // Save immediately to avoid losing progress
        writeFileSync(
          `${articlesDir}/${processed.id}.json`,
          JSON.stringify(processed, null, 2)
        );
        
        // Update in-memory cache
        this.existingData.set(processed.id, processed);
        
        if (processed.status === 'processed') {
          processedCount++;
          console.log(`✅ Success: ${processed.fetched_title || processed.user_title || 'Untitled'}`);
        } else {
          errorCount++;
          console.log(`❌ Error: ${processed.status} - ${processed.error || processed.llm_error || 'Unknown error'}`);
        }
        
        // Add delay between requests (be respectful)
        if (i < linksToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`💥 Failed to process ${link.canonical_url}:`, error);
        const errorArticle: ProcessedArticle = {
          ...link,
          processing_timestamp: new Date().toISOString(),
          status: 'error_scraping',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        // Save error immediately too
        writeFileSync(
          `${articlesDir}/${errorArticle.id}.json`,
          JSON.stringify(errorArticle, null, 2)
        );
        
        this.existingData.set(errorArticle.id, errorArticle);
        errorCount++;
      }
    }

    // Consolidate all data (existing + newly processed)
    const allArticles = Array.from(this.existingData.values());
    
    // Save consolidated data with metadata
    const consolidatedData = {
      metadata: {
        total_articles: allArticles.length,
        last_updated: new Date().toISOString(),
        processing_stats: {
          processed: allArticles.filter(a => a.status === 'processed').length,
          errors: allArticles.filter(a => a.status.includes('error')).length,
          skipped: allArticles.filter(a => a.status === 'skipped').length
        }
      },
      articles: allArticles
    };

    writeFileSync(
      'build_output/all_articles_data.json',
      JSON.stringify(consolidatedData, null, 2)
    );

    // Create downloadable dataset
    await this.createDatasetArchive(allArticles);

    console.log(`\n🎉 Processing complete!`);
    console.log(`📊 Final statistics:`);
    console.log(`  Total articles: ${allArticles.length}`);
    console.log(`  Successfully processed: ${allArticles.filter(a => a.status === 'processed').length}`);
    console.log(`  Errors: ${allArticles.filter(a => a.status.includes('error')).length}`);
    console.log(`  This session: +${processedCount} processed, ${errorCount} errors`);
  }

  private async createDatasetArchive(articles: ProcessedArticle[]): Promise<void> {
    try {
      // Create a simplified dataset for download
      const dataset = {
        metadata: {
          exported_at: new Date().toISOString(),
          total_articles: articles.length,
          format_version: "1.0",
          description: "LinkHarbor scraped and enriched article dataset"
        },
        articles: articles.map(article => ({
          id: article.id,
          original_url: article.original_url,
          canonical_url: article.canonical_url,
          user_title: article.user_title,
          user_tags: article.user_tags,
          user_notes: article.user_notes,
          fetched_title: article.fetched_title,
          summary: article.summary,
          auto_tags: article.auto_tags,
          keywords: article.keywords,
          content_type: article.content_type,
          read_time_minutes: article.read_time_minutes,
          processing_timestamp: article.processing_timestamp,
          status: article.status,
          // Include key metadata but not full content to keep size manageable
          has_content: !!article.main_text_content,
          has_image: !!article.key_image_url,
          has_structured_data: !!(article.json_ld_objects && article.json_ld_objects.length > 0)
        }))
      };

      // Ensure dist directory exists
      if (!existsSync('dist')) {
        mkdirSync('dist', { recursive: true });
      }

      // Write dataset as JSON (we'll zip it in the site generation step)
      writeFileSync(
        'dist/dataset.json',
        JSON.stringify(dataset, null, 2)
      );

      console.log(`📦 Dataset created: dist/dataset.json (${articles.length} articles)`);
    } catch (error) {
      console.error('Failed to create dataset archive:', error);
    }
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
    
    const processor = new LinkProcessor(refreshSince);
    await processor.processAllLinks();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
} 