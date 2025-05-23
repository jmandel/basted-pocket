#!/usr/bin/env bun

import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

interface TagDefinition {
  name: string;
  description: string;
  keywords_hint?: string[];
}

interface TagDefinitions {
  tags: TagDefinition[];
}

interface ScrapedArticle {
  id: string;
  original_url: string;
  canonical_url: string;
  user_title?: string;
  user_tags: string[];
  user_notes?: string;
  time_added_to_links_md?: string;
  fetched_title?: string;
  main_text_content?: string;
  main_html_content?: string;
  publication_date?: string;
  author?: string;
  key_image_url?: string;
  json_ld_objects?: any[];
  scraping_timestamp: string;
  scraping_status: 'scraped' | 'error_scraping' | 'skipped';
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

interface EnrichedArticle extends ScrapedArticle, EnrichedData {
  enrichment_timestamp: string;
  enrichment_status: 'enriched' | 'error_enrichment' | 'skipped';
}

class ContentEnricher {
  private gemini: GoogleGenAI;
  private tagDefinitions: TagDefinitions;
  private refreshSince: Date | null = null;
  private existingData: Map<string, EnrichedArticle> = new Map();

  constructor(refreshSince?: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    
    this.gemini = new GoogleGenAI({ apiKey });
    this.tagDefinitions = this.loadTagDefinitions();
    
    if (refreshSince) {
      this.refreshSince = new Date(refreshSince);
      console.log(`🔄 Refresh mode: will re-enrich articles since ${this.refreshSince.toISOString()}`);
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
      // Load from article directories in enriched directories
      const enrichedDirs = ['build_output/data/enriched', 'build_output/enriched'];
      let loadedCount = 0;
      
      for (const enrichedDir of enrichedDirs) {
        if (existsSync(enrichedDir)) {
          const articleDirs = require('fs').readdirSync(enrichedDir);
          for (const articleDir of articleDirs) {
            const articlePath = `${enrichedDir}/${articleDir}`;
            const dataFile = `${articlePath}/data.json`;
            
            // Check if it's a directory and has data.json
            if (require('fs').statSync(articlePath).isDirectory() && existsSync(dataFile)) {
              try {
                const article: EnrichedArticle = JSON.parse(readFileSync(dataFile, 'utf-8'));
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
                const article: EnrichedArticle = JSON.parse(readFileSync(articlePath, 'utf-8'));
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
        console.log(`📚 Loaded ${loadedCount} existing enriched articles from individual files`);
      }
    } catch (error) {
      console.warn('Could not load existing enriched data:', error);
    }
  }

  private shouldEnrichArticle(article: ScrapedArticle): boolean {
    const existing = this.existingData.get(article.id);
    
    if (!existing) {
      return true; // New article, always enrich
    }

    if (this.refreshSince) {
      const lastEnriched = new Date(existing.enrichment_timestamp);
      return lastEnriched < this.refreshSince;
    }

    // Don't re-enrich if we have good data
    return existing.enrichment_status !== 'enriched';
  }

  private async enrichWithGemini(textContent: string): Promise<EnrichedData> {
    try {
      if (!textContent || textContent.length < 50) {
        return { llm_error: 'Content too short for LLM processing' };
      }

      // Auto-tagging and analysis
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

  private async enrichArticle(article: ScrapedArticle): Promise<EnrichedArticle> {
    console.log(`🤖 Enriching: ${article.fetched_title || article.user_title || 'Untitled'}`);

    // Skip if no content to enrich
    if (!article.main_text_content || article.scraping_status !== 'scraped') {
      return {
        ...article,
        enrichment_timestamp: new Date().toISOString(),
        enrichment_status: 'skipped',
        llm_error: 'No content available for enrichment'
      };
    }

    // Enrich with LLM
    const enrichedData = await this.enrichWithGemini(article.main_text_content);

    return {
      ...article,
      ...enrichedData,
      enrichment_timestamp: new Date().toISOString(),
      enrichment_status: enrichedData.llm_error ? 'error_enrichment' : 'enriched'
    };
  }

  async enrichAllArticles(): Promise<void> {
    // Load scraped data from article directories
    const scrapedDirs = ['build_output/data/scraped', 'build_output/scraped'];
    const scrapedArticles: ScrapedArticle[] = [];
    
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
              scrapedArticles.push(article);
            } catch (error) {
              console.warn(`⚠️  Could not load scraped file ${dataFile}:`, error);
            }
          }
          // Also handle old format (direct JSON files) for backward compatibility
          else if (articleDir.endsWith('.json')) {
            try {
              const article: ScrapedArticle = JSON.parse(readFileSync(articlePath, 'utf-8'));
              scrapedArticles.push(article);
            } catch (error) {
              console.warn(`⚠️  Could not load scraped file ${articlePath}:`, error);
            }
          }
        }
      }
    }
    
    if (scrapedArticles.length === 0) {
      console.log('No scraped articles found to enrich. Run scrapeContent.ts first.');
      return;
    }
    
    console.log(`📚 Loaded ${scrapedArticles.length} scraped articles from individual files`);

    // Create output directories in new data structure
    const enrichedDir = 'build_output/data/enriched';
    if (!existsSync(enrichedDir)) {
      mkdirSync(enrichedDir, { recursive: true });
    }

    // Filter articles that need enrichment
    const articlesToEnrich = scrapedArticles.filter(article => this.shouldEnrichArticle(article));
    const skippedCount = scrapedArticles.length - articlesToEnrich.length;
    
    console.log(`📊 Enrichment status:`);
    console.log(`  Total scraped articles: ${scrapedArticles.length}`);
    console.log(`  Already enriched: ${skippedCount}`);
    console.log(`  Need enrichment: ${articlesToEnrich.length}`);

    let enrichedCount = 0;
    let errorCount = 0;
    let skippedThisRun = 0;

    // Enrich articles with incremental saving
    for (let i = 0; i < articlesToEnrich.length; i++) {
      const article = articlesToEnrich[i];
      if (!article) continue;
      
      try {
        console.log(`\n🤖 Enriching ${i + 1}/${articlesToEnrich.length}: ${article.canonical_url}`);
        
        const enriched = await this.enrichArticle(article);
        
        // Create article directory and save
        const articleDir = `${enrichedDir}/${enriched.id}`;
        if (!existsSync(articleDir)) {
          mkdirSync(articleDir, { recursive: true });
        }
        
        writeFileSync(
          `${articleDir}/data.json`,
          JSON.stringify(enriched, null, 2)
        );
        
        // Update in-memory cache
        this.existingData.set(enriched.id, enriched);
        
        if (enriched.enrichment_status === 'enriched') {
          enrichedCount++;
          console.log(`✅ Success: Generated ${enriched.auto_tags?.length || 0} tags, ${enriched.keywords?.length || 0} keywords`);
        } else if (enriched.enrichment_status === 'skipped') {
          skippedThisRun++;
          console.log(`⏭️  Skipped: ${enriched.llm_error || 'No content'}`);
        } else {
          errorCount++;
          console.log(`❌ Error: ${enriched.llm_error || 'Unknown error'}`);
        }
        
        // Add delay between LLM requests to avoid rate limits
        if (i < articlesToEnrich.length - 1 && enriched.enrichment_status === 'enriched') {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`💥 Failed to enrich ${article.canonical_url}:`, error);
        const errorArticle: EnrichedArticle = {
          ...article,
          enrichment_timestamp: new Date().toISOString(),
          enrichment_status: 'error_enrichment',
          llm_error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        // Save error immediately too
        const errorArticleDir = `${enrichedDir}/${errorArticle.id}`;
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

    // Merge with existing enriched data for articles not processed this time
    for (const scrapedArticle of scrapedArticles) {
      if (!this.existingData.has(scrapedArticle.id)) {
        // Article wasn't enriched, add it as-is
        const basicEnriched: EnrichedArticle = {
          ...scrapedArticle,
          enrichment_timestamp: new Date().toISOString(),
          enrichment_status: 'skipped'
        };
        this.existingData.set(scrapedArticle.id, basicEnriched);
      }
    }

    // All data is already saved as individual files in build_output/data/enriched/
    const allArticles = Array.from(this.existingData.values());

    // Create downloadable dataset
    await this.createDatasetArchive(allArticles);

    console.log(`\n🎉 Enrichment complete!`);
    console.log(`📊 Final statistics:`);
    console.log(`  Total articles: ${allArticles.length}`);
    console.log(`  Successfully enriched: ${allArticles.filter(a => a.enrichment_status === 'enriched').length}`);
    console.log(`  Errors: ${allArticles.filter(a => a.enrichment_status === 'error_enrichment').length}`);
    console.log(`  Skipped: ${allArticles.filter(a => a.enrichment_status === 'skipped').length}`);
    console.log(`  This session: +${enrichedCount} enriched, ${errorCount} errors, ${skippedThisRun} skipped`);
  }

  private async createDatasetArchive(articles: EnrichedArticle[]): Promise<void> {
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
          scraping_timestamp: article.scraping_timestamp,
          enrichment_timestamp: article.enrichment_timestamp,
          scraping_status: article.scraping_status,
          enrichment_status: article.enrichment_status,
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

      // Write dataset as JSON
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
    
    const enricher = new ContentEnricher(refreshSince);
    await enricher.enrichAllArticles();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
} 