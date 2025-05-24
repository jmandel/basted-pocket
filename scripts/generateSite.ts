#!/usr/bin/env bun

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parseLinksMarkdown, type ParsedLink } from './parseLinks.ts';

/**
 * Basted Pocket Static Site Generator
 * Merges fresh data from links.md with scraped content just-in-time
 */

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
  scraping_timestamp?: string;
  scraping_status?: 'scraped' | 'error_scraping' | 'skipped';
  error?: string;
}

interface ProcessedArticle extends ParsedLink {
  // Scraped data
  fetched_title?: string;
  main_text_content?: string;
  main_html_content?: string;
  publication_date?: string;
  author?: string;
  key_image_url?: string;
  local_image_path?: string;
  json_ld_objects?: any[];
  
  // Status tracking
  scraping_status?: 'scraped' | 'error_scraping' | 'skipped';
  error?: string;
}

interface SiteData {
  articles: ProcessedArticle[];
  tags: Record<string, ProcessedArticle[]>;
  contentTypes: Record<string, ProcessedArticle[]>;
  stats: {
    totalArticles: number;
    processedArticles: number;
    totalTags: number;
    topTags: Array<{ tag: string; count: number }>;
    contentTypes: Array<{ type: string; count: number }>;
  };
}

interface PageConfig {
  title: string;
  heading: string;
  description?: string;
  searchPlaceholder: string;
  relativePath: string;
  articles: ProcessedArticle[];
  allTags: string[];
  selectedTag?: string;
  showTagCloud?: boolean;
  showStats?: boolean;
  pageType: 'index' | 'tag' | 'contentType';
}

interface TemplateData {
  config: PageConfig;
  stats?: SiteData['stats'];
  searchData: any[];
}

class BastesPocketSiteGenerator {
  private outputDir: string;

  constructor(outputDir: string = 'dist') {
    this.outputDir = outputDir;
  }

  private isArticleDisplayable(article: ProcessedArticle): boolean {
    // Article is displayable if it has been successfully scraped
    return article.scraping_status === 'scraped';
  }

  private getImageUrl(article: ProcessedArticle, relativePath: string = ''): string | undefined {
    const localImagePath = (article as any).local_image_path;
    
    if (localImagePath) {
      // Convert from archive/articleId/image.jpg to images/articleId_image.jpg
      const match = localImagePath.match(/archive\/([^\/]+)\/(.+)/);
      if (match) {
        const [, articleId, filename] = match;
        return `${relativePath}images/${articleId}_${filename}`;
      }
    }
    
    // Fallback to remote image URL
    return article.key_image_url;
  }

  private createSearchData(articles: ProcessedArticle[], relativePath: string = ''): any[] {
    return articles
      .filter(a => this.isArticleDisplayable(a))
      .map(article => ({
        id: article.id,
        title: article.fetched_title || article.user_title || 'Untitled',
        summary: article.main_text_content?.substring(0, 200) || '',
        content: article.main_text_content?.substring(0, 500) || '',
        tags: article.user_tags || [],
        keywords: [],
        type: 'article',
        url: `${relativePath}articles/${article.id}.html`,
        readTime: Math.max(1, Math.round((article.main_text_content?.split(/\s+/).length || 0) / 200)),
        imageUrl: this.getImageUrl(article, relativePath)
      }));
  }

  async generateFromScrapedData(): Promise<void> {
    console.log('🔄 Merging fresh data from links.md with scraped content...');
    
    // Get fresh data from links.md
    const linksData = parseLinksMarkdown();
    console.log(`📖 Loaded ${linksData.length} links from links.md`);
    
    // Create a set of valid IDs from links.md for filtering
    const validIds = new Set(linksData.map(link => link.id));
    
    // Load scraped data
    const scrapedData = new Map<string, ScrapedData>();
    let filteredOutCount = 0;
    
    // Load scraped content
    const scrapedDirs = ['archive'];
    for (const scrapedDir of scrapedDirs) {
      if (existsSync(scrapedDir)) {
        const articleDirs = require('fs').readdirSync(scrapedDir);
        for (const articleDir of articleDirs) {
          const articlePath = `${scrapedDir}/${articleDir}`;
          const dataFile = `${articlePath}/data.json`;
          
          if (require('fs').statSync(articlePath).isDirectory() && existsSync(dataFile)) {
            try {
              const scraped = JSON.parse(readFileSync(dataFile, 'utf-8'));
              
              // Only include if it's in links.md OR it's marked as resurrected
              if (validIds.has(scraped.id) || scraped.resurrected) {
                scrapedData.set(scraped.id, scraped);
              } else {
                filteredOutCount++;
                console.log(`🗑️  Filtered out orphaned article: ${scraped.fetched_title || scraped.original_url || scraped.id}`);
              }
            } catch (error) {
              console.warn(`⚠️  Could not load ${dataFile}:`, error);
            }
          }
        }
      }
    }
    
    if (filteredOutCount > 0) {
      console.log(`🧹 Filtered out ${filteredOutCount} orphaned archive folders not in links.md`);
    }
    
    // Merge all data just-in-time
    const articles: ProcessedArticle[] = linksData.map(link => {
      const scraped = scrapedData.get(link.id);
      
      // Merge data but ensure fresh links.md data takes precedence for user fields
      const merged = {
        ...scraped, // Scraped web content
        ...link, // Fresh data from links.md - takes precedence
      };
      
      // Explicitly ensure user fields from links.md override any cached versions
      merged.user_tags = link.user_tags;
      merged.user_title = link.user_title;
      merged.user_notes = link.user_notes;
      
      return merged;
    });
    
    // Add resurrected articles that aren't in links.md (but only those marked as resurrected)
    const linksIds = new Set(linksData.map(link => link.id));
    for (const [scrapedId, scrapedArticle] of scrapedData) {
      if (!linksIds.has(scrapedId) && (scrapedArticle as any).resurrected) {
        // This is a resurrected article not in links.md
        // Cast to any since the actual scraped data has more fields than the interface
        const fullScrapedArticle = scrapedArticle as any;
        const resurrectedArticle: ProcessedArticle = {
          id: fullScrapedArticle.id,
          original_url: fullScrapedArticle.original_url,
          canonical_url: fullScrapedArticle.canonical_url,
          user_tags: [], // No user tags since it's not in links.md
          user_title: undefined,
          user_notes: undefined,
          ...fullScrapedArticle
        };
        articles.push(resurrectedArticle);
        console.log(`🔄 Added resurrected article: ${fullScrapedArticle.fetched_title || fullScrapedArticle.original_url}`);
      }
    }
    
    console.log(`✅ Merged ${articles.length} articles (${linksData.length} from links.md + ${articles.length - linksData.length} resurrected)`);
    console.log(`📊 Scraped: ${scrapedData.size}`);
    
    // Report on data completeness
    this.reportDataCompleteness(articles);
    
    const siteData = this.processSiteData(articles);
    await this.generateSite(siteData);
    await this.createDatasetZip();
  }

  private reportDataCompleteness(articles: ProcessedArticle[]): void {
    if (articles.length === 0) return;
    
    const scraped = articles.filter(a => (a as any).scraping_timestamp).length;
    const withImages = articles.filter(a => (a as any).local_image_path || a.key_image_url).length;
    
    console.log('\n📊 Data Completeness Report:');
    console.log(`   Total articles: ${articles.length}`);
    console.log(`   Scraped content: ${scraped}/${articles.length} (${Math.round(scraped/articles.length*100)}%)`);
    console.log(`   With images: ${withImages}/${articles.length} (${Math.round(withImages/articles.length*100)}%)`);
    
    if (scraped < articles.length) {
      console.log(`💡 ${articles.length - scraped} articles need scraping`);
    }
    console.log('');
  }

  private processSiteData(articles: ProcessedArticle[]): SiteData {
    const tags = this.groupByTags(articles);
    const contentTypes = this.groupByContentType(articles);
    
    // Calculate statistics - but only count displayable articles for tag counts
    const processedArticles = articles.filter(a => this.isArticleDisplayable(a));
    
    // Fix: Calculate tag counts based only on displayable articles to match individual tag pages
    const displayableTagCounts = Object.entries(tags).map(([tag, tagArticles]) => ({
      tag,
      count: tagArticles.filter(a => this.isArticleDisplayable(a)).length // Only count displayable articles
    })).sort((a, b) => b.count - a.count);
    
    const contentTypeCounts = Object.entries(contentTypes).map(([type, typeArticles]) => ({
      type,
      count: typeArticles.filter(a => this.isArticleDisplayable(a)).length // Also fix content type counts
    })).sort((a, b) => b.count - a.count);
    
    const stats = {
      totalArticles: articles.length,
      processedArticles: processedArticles.length,
      totalTags: Object.keys(tags).length,
      topTags: displayableTagCounts.slice(0, 20),
      contentTypes: contentTypeCounts
    };
    
    return { articles, tags, contentTypes, stats };
  }

  private groupByTags(articles: ProcessedArticle[]): Record<string, ProcessedArticle[]> {
    const groups: Record<string, ProcessedArticle[]> = {};
    
    for (const article of articles) {
      // Use only user tags since we removed enrichment
      const allTags = article.user_tags || [];
      
      for (const tag of allTags) {
        if (!groups[tag]) {
          groups[tag] = [];
        }
        groups[tag].push(article);
      }
    }
    
    return groups;
  }

  private groupByContentType(articles: ProcessedArticle[]): Record<string, ProcessedArticle[]> {
    const groups: Record<string, ProcessedArticle[]> = {};
    
    for (const article of articles) {
      const type = 'article'; // Default since we removed content type detection
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(article);
    }
    
    return groups;
  }

  private async generateSite(data: SiteData): Promise<void> {
    console.log('🏗️  Generating static site...');
    
    // Create output directory
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
    
    // Copy images from build_output to dist (only for included articles)
    await this.copyImages(data.articles);
    
    // Generate main index page
    await this.generateIndexPage(data);
    
    // Generate individual article pages
    await this.generateArticlePages(data);
    
    // Generate tag pages
    await this.generateTagPages(data);
    
    // Generate content type pages
    await this.generateContentTypePages(data);
    
    // Generate search data
    await this.generateSearchData(data);
    
    // Copy static assets
    await this.generateStaticAssets();
    
    console.log(`✅ Site generated in ${this.outputDir}/`);
    console.log(`📊 ${data.stats.processedArticles}/${data.stats.totalArticles} articles processed successfully`);
  }

  private async copyImages(articles: ProcessedArticle[]): Promise<void> {
    try {
      // Create a set of valid article IDs to only copy images for included articles
      const validArticleIds = new Set(articles.map(article => article.id));
      
      // Copy images from article directories
      const sourceDataDirs = ['archive'];
      const destImagesDir = join(this.outputDir, 'images');
      
      if (!existsSync(destImagesDir)) {
        mkdirSync(destImagesDir, { recursive: true });
      }

      let copiedCount = 0;
      let skippedCount = 0;
      const copiedImages = new Set<string>(); // Track copied images to avoid duplicates

      for (const sourceDir of sourceDataDirs) {
        if (existsSync(sourceDir)) {
          const articleDirs = require('fs').readdirSync(sourceDir);
          
          for (const articleDir of articleDirs) {
            // Skip if this article is not included in the site
            if (!validArticleIds.has(articleDir)) {
              skippedCount++;
              continue;
            }
            
            const articlePath = `${sourceDir}/${articleDir}`;
            
            // Check if it's a directory
            if (require('fs').statSync(articlePath).isDirectory()) {
              const files = require('fs').readdirSync(articlePath);
              
              for (const file of files) {
                // Copy image files (not data.json or content.html)
                if (file.startsWith('image.') && !file.endsWith('.json') && !file.endsWith('.html')) {
                  const destFileName = `${articleDir}_${file}`;
                  
                  // Skip if already copied
                  if (copiedImages.has(destFileName)) {
                    continue;
                  }
                  
                  const sourcePath = join(articlePath, file);
                  const destPath = join(destImagesDir, destFileName);
                  
                  try {
                    const sourceContent = readFileSync(sourcePath);
                    writeFileSync(destPath, sourceContent);
                    copiedImages.add(destFileName);
                    copiedCount++;
                  } catch (error) {
                    console.warn(`Failed to copy image ${file} from ${articleDir}:`, error);
                  }
                }
              }
            }
          }
        }
      }

      console.log(`📷 Copied ${copiedCount} images to ${destImagesDir} (${copiedImages.size} unique images)`);
      if (skippedCount > 0) {
        console.log(`🗑️  Skipped ${skippedCount} image directories for filtered articles`);
      }
    } catch (error) {
      console.warn('Failed to copy images:', error);
    }
  }

  private async generateIndexPage(data: SiteData): Promise<void> {
    const displayableArticles = data.articles.filter(a => this.isArticleDisplayable(a));
    const allTags = data.stats.topTags.map(({ tag }) => tag).sort();
    
    const config: PageConfig = {
      title: 'Basted Pocket - Your Recipe Collection',
      heading: 'Basted Pocket',
      searchPlaceholder: 'Search recipes, summaries, tags...',
      relativePath: '',
      articles: displayableArticles,
      allTags,
      showTagCloud: true,
      showStats: true,
      pageType: 'index'
    };

    const searchData = this.createSearchData(displayableArticles);
    
    const templateData: TemplateData = {
      config,
      stats: data.stats,
      searchData
    };

    const html = this.generatePageTemplate(templateData);
    writeFileSync(join(this.outputDir, 'index.html'), html);
  }

  private async generateTagPages(data: SiteData): Promise<void> {
    const tagsDir = join(this.outputDir, 'tags');
    if (!existsSync(tagsDir)) {
      mkdirSync(tagsDir, { recursive: true });
    }

    for (const [tag, articles] of Object.entries(data.tags)) {
      const processedArticles = articles.filter(a => this.isArticleDisplayable(a));
      
      // Get all unique tags for filters
      const allTags = new Set<string>();
      processedArticles.forEach(article => {
        (article.user_tags || []).forEach(t => allTags.add(t));
      });
      
      const config: PageConfig = {
        title: `Tag: ${tag} - Basted Pocket`,
        heading: `Tag: ${tag}`,
        searchPlaceholder: `Search within ${tag} recipes...`,
        relativePath: '../',
        articles: processedArticles,
        allTags: Array.from(allTags).sort(),
        selectedTag: tag,
        pageType: 'tag'
      };

      const searchData = this.createSearchData(processedArticles, '../');
      
      const templateData: TemplateData = {
        config,
        stats: data.stats,
        searchData
      };

      const html = this.generatePageTemplate(templateData);
      writeFileSync(join(tagsDir, `${tag}.html`), html);
    }
  }

  private async generateContentTypePages(data: SiteData): Promise<void> {
    const typesDir = join(this.outputDir, 'types');
    if (!existsSync(typesDir)) {
      mkdirSync(typesDir, { recursive: true });
    }

    for (const [type, articles] of Object.entries(data.contentTypes)) {
      const processedArticles = articles.filter(a => this.isArticleDisplayable(a));
      
      // Get all unique tags for filters
      const allTags = new Set<string>();
      processedArticles.forEach(article => {
        (article.user_tags || []).forEach(t => allTags.add(t));
      });
      
      const config: PageConfig = {
        title: `Type: ${type} - Basted Pocket`,
        heading: `Content Type: ${type}`,
        searchPlaceholder: `Search within ${type} content...`,
        relativePath: '../',
        articles: processedArticles,
        allTags: Array.from(allTags).sort(),
        pageType: 'contentType'
      };

      const searchData = this.createSearchData(processedArticles, '../');
      
      const templateData: TemplateData = {
        config,
        stats: data.stats,
        searchData
      };

      const html = this.generatePageTemplate(templateData);
      writeFileSync(join(typesDir, `${type}.html`), html);
    }
  }

  private async generateArticlePages(data: SiteData): Promise<void> {
    const articlesDir = join(this.outputDir, 'articles');
    if (!existsSync(articlesDir)) {
      mkdirSync(articlesDir, { recursive: true });
    }

    for (const article of data.articles.filter(a => this.isArticleDisplayable(a))) {
      const html = this.generateArticlePage(article);
      writeFileSync(join(articlesDir, `${article.id}.html`), html);
    }
  }

  private generateArticlePage(article: ProcessedArticle): string {
    const title = article.fetched_title || article.user_title || 'Untitled';
    const allTags = article.user_tags || [];
    const uniqueTags = [...new Set(allTags)];
    
    // Use local image if available, fallback to remote - use ../ for article pages
    const imageUrl = this.getImageUrl(article, '../');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Basted Pocket</title>
    <link rel="stylesheet" href="../assets/style.css">
    <meta name="description" content="${article.main_text_content?.substring(0, 200) || 'Recipe from Basted Pocket'}">
</head>
<body>
    <header class="header">
        <div class="container">
            <a href="../index.html" class="logo">👨‍🍳 Basted Pocket</a>
        </div>
    </header>

    <main class="container">
        <article class="article-detail">
            <header class="article-header">
                <h1>${title}</h1>
                <div class="article-meta">
                    ${article.author ? `<span class="author">By ${article.author}</span>` : ''}
                </div>
                <div class="article-actions">
                    <a href="${article.canonical_url}" target="_blank" rel="noopener" class="btn-primary">Read Original</a>
                </div>
            </header>

            ${imageUrl ? `
            <div class="article-image">
                <img src="${imageUrl}" alt="${title}" loading="lazy">
            </div>
            ` : ''}

            ${article.main_text_content ? `
            <div class="article-summary">
                <h2>Summary</h2>
                <p>${article.main_text_content.substring(0, 200)}...</p>
            </div>
            ` : ''}

            ${article.json_ld_objects && article.json_ld_objects.length > 0 ? `
            <div class="structured-content">
                ${this.renderJsonLdData(article.json_ld_objects)}
            </div>
            ` : ''}

            ${article.main_html_content ? (() => {
              // Check if this article has recipe data in JSON-LD
              const hasRecipeData = article.json_ld_objects && 
                article.json_ld_objects.some((obj: any) => 
                  Array.isArray(obj) ? obj.some((item: any) => item['@type'] === 'Recipe') :
                  obj['@type'] === 'Recipe'
                );
              
              // For articles with structured recipe data, skip content preview entirely
              if (hasRecipeData) {
                return '';
              }
              
              // For other articles, show cleaned content preview
              const cleanedContent = this.cleanContentPreview(article.main_html_content, false);
              return cleanedContent ? `
            <div class="article-content">
                <h2>Content Preview</h2>
                <div class="content-text">
                      ${cleanedContent.split('\n').map(p => p.trim() ? `<p>${p}</p>` : '').join('')}
                </div>
            </div>
              ` : '';
            })() : ''}

            ${uniqueTags.length > 0 ? `
            <div class="article-tags">
                <h3>Tags</h3>
                <div class="tags">
                    ${uniqueTags.map(tag => `<a href="../tags/${tag}.html" class="tag">${tag}</a>`).join('')}
                </div>
            </div>
            ` : ''}

            ${article.user_notes ? `
            <div class="article-notes">
                <h3>Notes</h3>
                <p>${article.user_notes}</p>
            </div>
            ` : ''}

            ${article.json_ld_objects && article.json_ld_objects.length > 0 ? `
            <div class="raw-structured-data">
                <h3>Raw Structured Data</h3>
                <details>
                    <summary>View JSON-LD Data</summary>
                    <pre><code>${JSON.stringify(article.json_ld_objects, null, 2)}</code></pre>
                </details>
            </div>
            ` : ''}
        </article>
    </main>
</body>
</html>`;
  }

  private renderJsonLdData(jsonLdObjects: any[]): string {
    if (!jsonLdObjects || jsonLdObjects.length === 0) return '';

    let renderedData = '';

    // Flatten nested arrays - sometimes JSON-LD data is stored as [[{...}]] instead of [{...}]
    const flattenedObjects = jsonLdObjects.flat();
    
    // Handle @graph structures and build a lookup map for @id references
    const allObjects: any[] = [];
    const idLookup = new Map<string, any>();
    
    for (const obj of flattenedObjects) {
      if (obj && obj['@graph']) {
        // Extract objects from @graph
        for (const graphObj of obj['@graph']) {
          allObjects.push(graphObj);
          if (graphObj['@id']) {
            idLookup.set(graphObj['@id'], graphObj);
          }
        }
      } else if (obj) {
        allObjects.push(obj);
        if (obj['@id']) {
          idLookup.set(obj['@id'], obj);
        }
      }
    }
    
    // Helper function to resolve @id references
    const resolveReference = (ref: any): any => {
      if (typeof ref === 'string') {
        return idLookup.get(ref);
      }
      if (ref && ref['@id']) {
        return idLookup.get(ref['@id']) || ref;
      }
      return ref;
    };
    
    // Helper function to resolve array of references
    const resolveReferences = (refs: any[]): any[] => {
      return refs.map(resolveReference).filter(Boolean);
    };
    
    // Group objects by type for better presentation
    const recipes: any[] = [];
    const reviews: any[] = [];
    const comments: any[] = [];
    const articles: any[] = [];
    const videos: any[] = [];
    const images: any[] = [];
    const howToSteps: any[] = [];
    const questions: any[] = [];
    const answers: any[] = [];
    const ratings: any[] = [];
    const nutrition: any[] = [];
    const products: any[] = [];
    const entities: any[] = [];
    const events: any[] = [];
    const breadcrumbs: any[] = [];
    const others: any[] = [];

    // Track video IDs that are part of recipes to avoid duplicates
    const recipeVideoIds = new Set<string>();

    for (const obj of allObjects) {
      if (obj && obj['@type']) {
        const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
        
        // Skip low-value QuantitativeValue objects (width/height measurements)
        if (types.includes('QuantitativeValue')) {
          const name = obj.name?.toLowerCase() || '';
          if (name === 'width' || name === 'height') {
            continue; // Skip these low-value measurements
          }
        }
        
        if (types.includes('Recipe')) {
          recipes.push(obj);
          // Track video IDs that are part of this recipe
          if (obj.video) {
            if (Array.isArray(obj.video)) {
              obj.video.forEach((v: any) => {
                if (v['@id']) recipeVideoIds.add(v['@id']);
                else if (v['@type'] === 'VideoObject' && v['@id']) recipeVideoIds.add(v['@id']);
              });
            } else if (obj.video['@id']) {
              recipeVideoIds.add(obj.video['@id']);
            } else if (obj.video['@type'] === 'VideoObject' && obj.video['@id']) {
              recipeVideoIds.add(obj.video['@id']);
            }
          }
        } else if (types.includes('Review')) {
          reviews.push(obj);
        } else if (types.includes('Comment')) {
          comments.push(obj);
        } else if (types.includes('Article') || types.includes('NewsArticle') || types.includes('BlogPosting')) {
          articles.push(obj);
        } else if (types.includes('VideoObject')) {
          // Only add standalone videos that are not part of recipes
          if (!recipeVideoIds.has(obj['@id'])) {
            videos.push(obj);
          }
        } else if (types.includes('ImageObject')) {
          images.push(obj);
        } else if (types.includes('HowToStep')) {
          howToSteps.push(obj);
        } else if (types.includes('Question')) {
          questions.push(obj);
        } else if (types.includes('Answer')) {
          answers.push(obj);
        } else if (types.includes('AggregateRating')) {
          ratings.push(obj);
        } else if (types.includes('NutritionInformation')) {
          nutrition.push(obj);
        } else if (types.includes('Product')) {
          products.push(obj);
        } else if (types.includes('Organization') || types.includes('Person')) {
          entities.push(obj);
        } else if (types.includes('Event')) {
          events.push(obj);
        } else if (types.includes('BreadcrumbList')) {
          breadcrumbs.push(obj);
        } else {
          // Skip QuantitativeValue and other low-value types
          if (!types.includes('QuantitativeValue')) {
            others.push(obj);
          }
        }
      }
    }

    // Render grouped content in order of importance
    if (recipes.length > 0) {
      // Smart filtering: only skip ID-less recipes if there are multiple recipes AND some have IDs
      let filteredRecipes = recipes;
      if (recipes.length > 1) {
        const recipesWithIds = recipes.filter(recipe => recipe['@id']);
        // Only filter if some recipes have IDs (to avoid duplicates)
        // If no recipes have IDs, keep all of them
        if (recipesWithIds.length > 0) {
          filteredRecipes = recipesWithIds;
        }
      }
      
      // Resolve comment references for recipes
      filteredRecipes.forEach(recipe => {
        if (recipe.comment && Array.isArray(recipe.comment)) {
          recipe.resolvedComments = resolveReferences(recipe.comment);
        }
        
        // Resolve video references for recipes
        if (recipe.video) {
          if (Array.isArray(recipe.video)) {
            recipe.resolvedVideos = resolveReferences(recipe.video).filter((v: any) => v && v['@type'] === 'VideoObject');
          } else if (recipe.video['@id']) {
            const resolvedVideo = resolveReference(recipe.video);
            if (resolvedVideo && resolvedVideo['@type'] === 'VideoObject') {
              recipe.resolvedVideos = [resolvedVideo];
            }
          } else if (recipe.video['@type'] === 'VideoObject') {
            recipe.resolvedVideos = [recipe.video];
          }
        }
      });
      
      // Group recipes by name to avoid duplicate headers
      const recipeGroups = new Map<string, any[]>();
      for (const recipe of filteredRecipes) {
        const name = recipe.name || 'Unnamed Recipe';
        if (!recipeGroups.has(name)) {
          recipeGroups.set(name, []);
        }
        recipeGroups.get(name)!.push(recipe);
      }
      
      if (recipeGroups.size === 1 && filteredRecipes.length === 1) {
        renderedData += this.renderRecipeData(filteredRecipes[0]);
      } else {
        renderedData += this.renderGroupedRecipes(recipeGroups);
      }
    }

    if (breadcrumbs.length > 0) {
      renderedData += this.renderBreadcrumbsData(breadcrumbs);
    }

    if (reviews.length > 0) {
      renderedData += this.renderReviewsData(reviews);
    }

    if (ratings.length > 0) {
      renderedData += this.renderRatingsData(ratings);
    }

    if (videos.length > 0) {
      renderedData += this.renderVideosData(videos);
    }

    // Render comments from both standalone comments and resolved recipe comments
    const allComments = [...comments];
    if (recipes.length > 0) {
      // Use filtered recipes for comment resolution
      let filteredRecipes = recipes;
      if (recipes.length > 1) {
        const recipesWithIds = recipes.filter(recipe => recipe['@id']);
        // Only filter if some recipes have IDs (to avoid duplicates)
        // If no recipes have IDs, keep all of them
        if (recipesWithIds.length > 0) {
          filteredRecipes = recipesWithIds;
        }
      }
      
      for (const recipe of filteredRecipes) {
        if (recipe.resolvedComments) {
          allComments.push(...recipe.resolvedComments);
        }
      }
    }
    if (allComments.length > 0) {
      renderedData += this.renderCommentsData(allComments);
    }

    if (howToSteps.length > 0) {
      renderedData += this.renderHowToStepsData(howToSteps);
    }

    if (images.length > 0 && images.length <= 10) { // Only show if reasonable number
      renderedData += this.renderImagesData(images);
    }

    if (questions.length > 0 || answers.length > 0) {
      renderedData += this.renderQAData(questions, answers);
    }

    if (nutrition.length > 0) {
      renderedData += this.renderNutritionData(nutrition);
    }

    // Render other types
    articles.forEach(obj => renderedData += this.renderArticleData(obj));
    products.forEach(obj => renderedData += this.renderProductData(obj));
    entities.forEach(obj => renderedData += this.renderEntityData(obj));
    events.forEach(obj => renderedData += this.renderEventData(obj));
    others.forEach(obj => renderedData += this.renderGenericData(obj));

    return renderedData;
  }

  private renderGroupedRecipes(recipeGroups: Map<string, any[]>): string {
    return `
    <div class="structured-data recipes-data">
      <h3>🍳 Recipes (${Array.from(recipeGroups.values()).flat().length})</h3>
      <div class="recipes-container">
        ${Array.from(recipeGroups.entries()).map(([recipeName, recipeVariants], groupIndex) => `
        <div class="recipe-group">
          <h4>${recipeName}</h4>
          ${recipeVariants.map((recipe, variantIndex) => `
          <div class="recipe-variant">
            ${recipeVariants.length > 1 ? `<h5>Variant ${variantIndex + 1}</h5>` : ''}
            ${recipe.description ? `<p class="recipe-description">${recipe.description}</p>` : ''}
            
            ${this.renderRecipeVideos(recipe)}
            
            <div class="recipe-meta">
              ${recipe.prepTime ? `<span class="prep-time">⏱️ Prep: ${this.formatDuration(recipe.prepTime)}</span>` : ''}
              ${recipe.cookTime ? `<span class="cook-time">🔥 Cook: ${this.formatDuration(recipe.cookTime)}</span>` : ''}
              ${recipe.totalTime ? `<span class="total-time">⏰ Total: ${this.formatDuration(recipe.totalTime)}</span>` : ''}
              ${recipe.recipeYield ? `<span class="servings">👥 Serves: ${recipe.recipeYield}</span>` : ''}
            </div>

            ${recipe.recipeIngredient && recipe.recipeIngredient.length > 0 ? `
            <div class="recipe-ingredients">
              <h6>Ingredients:</h6>
              <ul>
                ${recipe.recipeIngredient.map((ingredient: string) => `<li>${ingredient}</li>`).join('')}
              </ul>
            </div>
            ` : ''}

            ${recipe.recipeInstructions && recipe.recipeInstructions.length > 0 ? (() => {
              const validInstructions = recipe.recipeInstructions.map((instruction: any) => {
                const text = typeof instruction === 'string' ? instruction : instruction.text || instruction.name || '';
                return text.trim() ? `<li>${text}</li>` : '';
              }).filter(Boolean);
              
              return validInstructions.length > 0 ? `
              <div class="recipe-instructions">
                <h6>Instructions:</h6>
                <ol>
                  ${validInstructions.join('')}
                </ol>
              </div>
              ` : '';
            })() : ''}

            ${recipe.nutrition ? `
            <div class="recipe-nutrition">
              <h6>Nutrition:</h6>
              <div class="nutrition-facts">
                ${recipe.nutrition.calories ? `<span>Calories: ${recipe.nutrition.calories}</span>` : ''}
                ${recipe.nutrition.protein ? `<span>Protein: ${recipe.nutrition.protein}</span>` : ''}
                ${recipe.nutrition.carbohydrate ? `<span>Carbs: ${recipe.nutrition.carbohydrate}</span>` : ''}
                ${recipe.nutrition.fat ? `<span>Fat: ${recipe.nutrition.fat}</span>` : ''}
              </div>
            </div>
            ` : ''}
          </div>
          ${variantIndex < recipeVariants.length - 1 ? '<hr class="recipe-variant-separator">' : ''}
          `).join('')}
        </div>
        ${groupIndex < recipeGroups.size - 1 ? '<hr class="recipe-separator">' : ''}
        `).join('')}
      </div>
    </div>`;
  }

  private renderRecipeData(recipe: any): string {
    return `
    <div class="structured-data recipe-data">
      <h3>🍳 Recipe Information</h3>
      <div class="recipe-details">
        ${recipe.name ? `<h4>${recipe.name}</h4>` : ''}
        ${recipe.description ? `<p class="recipe-description">${recipe.description}</p>` : ''}
        
        ${this.renderRecipeVideos(recipe)}
        
        <div class="recipe-meta">
          ${recipe.prepTime ? `<span class="prep-time">⏱️ Prep: ${this.formatDuration(recipe.prepTime)}</span>` : ''}
          ${recipe.cookTime ? `<span class="cook-time">🔥 Cook: ${this.formatDuration(recipe.cookTime)}</span>` : ''}
          ${recipe.totalTime ? `<span class="total-time">⏰ Total: ${this.formatDuration(recipe.totalTime)}</span>` : ''}
          ${recipe.recipeYield ? `<span class="servings">👥 Serves: ${recipe.recipeYield}</span>` : ''}
        </div>

        ${recipe.recipeIngredient && recipe.recipeIngredient.length > 0 ? `
        <div class="recipe-ingredients">
          <h5>Ingredients:</h5>
          <ul>
            ${recipe.recipeIngredient.map((ingredient: string) => `<li>${ingredient}</li>`).join('')}
          </ul>
        </div>
        ` : ''}

        ${recipe.recipeInstructions && recipe.recipeInstructions.length > 0 ? (() => {
          const validInstructions = recipe.recipeInstructions.map((instruction: any) => {
            const text = typeof instruction === 'string' ? instruction : instruction.text || instruction.name || '';
            return text.trim() ? `<li>${text}</li>` : '';
          }).filter(Boolean);
          
          return validInstructions.length > 0 ? `
        <div class="recipe-instructions">
            <h6>Instructions:</h6>
          <ol>
              ${validInstructions.join('')}
          </ol>
        </div>
          ` : '';
        })() : ''}

        ${recipe.nutrition ? `
        <div class="recipe-nutrition">
          <h5>Nutrition:</h5>
          <div class="nutrition-facts">
            ${recipe.nutrition.calories ? `<span>Calories: ${recipe.nutrition.calories}</span>` : ''}
            ${recipe.nutrition.protein ? `<span>Protein: ${recipe.nutrition.protein}</span>` : ''}
            ${recipe.nutrition.carbohydrate ? `<span>Carbs: ${recipe.nutrition.carbohydrate}</span>` : ''}
            ${recipe.nutrition.fat ? `<span>Fat: ${recipe.nutrition.fat}</span>` : ''}
          </div>
        </div>
        ` : ''}
      </div>
    </div>`;
  }

  private renderRecipeVideos(recipe: any): string {
    if (!recipe.resolvedVideos || recipe.resolvedVideos.length === 0) return '';

    if (recipe.resolvedVideos.length === 1) {
      return `
      <div class="recipe-video">
        ${this.renderSingleVideo(recipe.resolvedVideos[0])}
      </div>`;
    } else {
      return `
      <div class="recipe-videos">
        ${recipe.resolvedVideos.map((video: any) => this.renderSingleVideo(video)).join('')}
      </div>`;
    }
  }

  private renderBreadcrumbsData(breadcrumbs: any[]): string {
    return `
    <div class="structured-data breadcrumbs-data">
      <h3>🧭 Navigation</h3>
      <div class="breadcrumbs-container">
        ${breadcrumbs.map(breadcrumbList => `
        <nav class="breadcrumb-nav" aria-label="Breadcrumb">
          <ol class="breadcrumb-list">
            ${(breadcrumbList.itemListElement || []).map((item: any, index: number) => `
            <li class="breadcrumb-item">
              ${item.item && item.item !== '#' ? `
              <a href="${item.item}" class="breadcrumb-link" target="_blank">
                ${item.name || `Step ${item.position || index + 1}`}
              </a>
              ` : `
              <span class="breadcrumb-text">${item.name || `Step ${item.position || index + 1}`}</span>
              `}
              ${index < (breadcrumbList.itemListElement || []).length - 1 ? `
              <span class="breadcrumb-separator" aria-hidden="true">›</span>
              ` : ''}
            </li>
            `).join('')}
          </ol>
        </nav>
        `).join('')}
      </div>
    </div>`;
  }

  private renderReviewsData(reviews: any[]): string {
    // Sort reviews by date if available
    const sortedReviews = reviews.sort((a, b) => {
      const dateA = a.datePublished || a.dateCreated || '';
      const dateB = b.datePublished || b.dateCreated || '';
      return dateB.localeCompare(dateA);
    });

    // Show top 10 reviews
    const reviewsToShow = sortedReviews.slice(0, 10);

    return `
    <div class="structured-data reviews-data">
      <h3>⭐ User Reviews (${reviews.length})</h3>
      <div class="reviews-container">
        ${reviewsToShow.map(review => `
        <div class="review-item">
          <div class="review-header">
            <span class="review-author">${this.formatAuthor(review.author)}</span>
            ${review.datePublished || review.dateCreated ? `
            <span class="review-date">${new Date(review.datePublished || review.dateCreated).toLocaleDateString()}</span>
            ` : ''}
            ${review.reviewRating ? `
            <span class="review-rating">⭐ ${this.formatRating(review.reviewRating)}</span>
            ` : ''}
          </div>
          <div class="review-body">
            ${review.reviewBody || review.text || review.description || 'No review text'}
          </div>
        </div>
        `).join('')}
        ${reviews.length > 10 ? `<p class="more-reviews">... and ${reviews.length - 10} more reviews</p>` : ''}
      </div>
    </div>`;
  }

  private renderCommentsData(comments: any[]): string {
    // Sort comments by date if available
    const sortedComments = comments.sort((a, b) => {
      const dateA = a.dateCreated || a.datePublished || '';
      const dateB = b.dateCreated || b.datePublished || '';
      return dateB.localeCompare(dateA);
    });

    // Show top 8 comments initially
    const initialCommentsToShow = 8;
    const commentsToShow = sortedComments.slice(0, initialCommentsToShow);
    const hasMoreComments = sortedComments.length > initialCommentsToShow;

    return `
    <div class="structured-data comments-data">
      <h3>💬 Comments (${comments.length})</h3>
      <div class="comments-container">
        <div class="comments-visible">
          ${commentsToShow.map(comment => `
          <div class="comment-item">
            <div class="comment-header">
              <span class="comment-author">${this.formatAuthor(comment.author)}</span>
              ${comment.dateCreated || comment.datePublished ? `
              <span class="comment-date">${new Date(comment.dateCreated || comment.datePublished).toLocaleDateString()}</span>
              ` : ''}
            </div>
            <div class="comment-body">
              ${comment.text || comment.description || 'No comment text'}
            </div>
            ${comment.url ? `<a href="${comment.url}" class="comment-link" target="_blank">View Comment</a>` : ''}
          </div>
          `).join('')}
        </div>
        ${hasMoreComments ? `
        <div class="comments-hidden" style="display: none;">
          ${sortedComments.slice(initialCommentsToShow).map(comment => `
          <div class="comment-item">
            <div class="comment-header">
              <span class="comment-author">${this.formatAuthor(comment.author)}</span>
              ${comment.dateCreated || comment.datePublished ? `
              <span class="comment-date">${new Date(comment.dateCreated || comment.datePublished).toLocaleDateString()}</span>
              ` : ''}
            </div>
            <div class="comment-body">
              ${comment.text || comment.description || 'No comment text'}
            </div>
            ${comment.url ? `<a href="${comment.url}" class="comment-link" target="_blank">View Comment</a>` : ''}
          </div>
          `).join('')}
        </div>
        <button class="expand-comments-btn" onclick="this.parentElement.querySelector('.comments-hidden').style.display='block'; this.style.display='none';">
          Show ${sortedComments.length - initialCommentsToShow} more comments
        </button>
        ` : ''}
      </div>
    </div>`;
  }

  private renderHowToStepsData(steps: any[]): string {
    // Filter out blank steps
    const validSteps = steps.filter(step => {
      const text = step.text || step.name || step.description || '';
      return text.trim().length > 0;
    });
    
    // If no valid steps, don't render the section
    if (validSteps.length === 0) {
      return '';
    }
    
    return `
    <div class="structured-data howto-steps-data">
      <h3>📋 Instructions (${validSteps.length} steps)</h3>
      <div class="steps-container">
        <ol class="steps-list">
          ${validSteps.map((step, index) => `
          <li class="step-item">
            <div class="step-content">
              ${step.text || step.name || step.description}
            </div>
            ${step.image ? `
            <div class="step-image">
              <img src="${typeof step.image === 'string' ? step.image : step.image.url || step.image.contentUrl}" 
                   alt="Step ${index + 1}" loading="lazy">
            </div>
            ` : ''}
          </li>
          `).join('')}
        </ol>
      </div>
    </div>`;
  }

  private renderVideosData(videos: any[]): string {
    return `
    <div class="structured-data videos-data">
      <h3>🎥 Videos (${videos.length})</h3>
      <div class="videos-container">
        ${videos.map(video => this.renderSingleVideo(video)).join('')}
      </div>
    </div>`;
  }

  private renderSingleVideo(video: any): string {
    return `
    <div class="video-item">
      <div class="video-info">
        <h4>${video.name || video.headline || 'Video'}</h4>
        ${video.description ? `<p class="video-description">${video.description}</p>` : ''}
        <div class="video-meta">
          ${video.duration ? `<span class="video-duration">⏱️ ${this.formatDuration(video.duration)}</span>` : ''}
          ${video.uploadDate ? `<span class="video-date">📅 ${new Date(video.uploadDate).toLocaleDateString()}</span>` : ''}
        </div>
      </div>
      ${video.contentUrl || video.embedUrl ? `
      <div class="video-player">
        ${video.embedUrl ? `
        <iframe src="${video.embedUrl}" frameborder="0" allowfullscreen></iframe>
        ` : `
        <video controls>
          <source src="${video.contentUrl}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
        `}
      </div>
      ` : video.thumbnailUrl ? `
      <div class="video-thumbnail">
        <img src="${video.thumbnailUrl}" alt="${video.name || 'Video thumbnail'}" loading="lazy">
      </div>
      ` : ''}
    </div>`;
  }

  private renderImagesData(images: any[]): string {
    // Filter out very small images (likely icons)
    const meaningfulImages = images.filter(img => {
      const width = parseInt(img.width) || 0;
      const height = parseInt(img.height) || 0;
      return width >= 200 || height >= 200 || (!img.width && !img.height);
    });

    if (meaningfulImages.length === 0) return '';

    return `
    <div class="structured-data images-data">
      <h3>🖼️ Images (${meaningfulImages.length})</h3>
      <div class="images-gallery">
        ${meaningfulImages.map(image => `
        <div class="image-item">
          <img src="${image.contentUrl || image.url}" 
               alt="${image.caption || image.name || 'Image'}" 
               loading="lazy">
          ${image.caption ? `<div class="image-caption">${image.caption}</div>` : ''}
          ${image.creditText ? `<div class="image-credit">${image.creditText}</div>` : ''}
        </div>
        `).join('')}
      </div>
    </div>`;
  }

  private renderQAData(questions: any[], answers: any[]): string {
    // Try to match questions with answers
    const qaItems: Array<{question: any, answers: any[]}> = [];
    
    for (const question of questions) {
      const matchingAnswers = answers.filter(answer => 
        answer.parentItem?.['@id'] === question['@id'] ||
        answer.parentItem === question['@id']
      );
      qaItems.push({ question, answers: matchingAnswers });
    }

    // Add standalone answers
    const standaloneAnswers = answers.filter(answer => 
      !questions.some(q => 
        answer.parentItem?.['@id'] === q['@id'] || 
        answer.parentItem === q['@id']
      )
    );

    return `
    <div class="structured-data qa-data">
      <h3>❓ Questions & Answers</h3>
      <div class="qa-container">
        ${qaItems.map(({ question, answers }) => `
        <div class="qa-item">
          <div class="question">
            <h4>Q: ${question.name || question.text || 'Question'}</h4>
            ${question.description ? `<p>${question.description}</p>` : ''}
          </div>
          ${answers.length > 0 ? `
          <div class="answers">
            ${answers.map(answer => `
            <div class="answer">
              <h5>A: ${this.formatAuthor(answer.author)}</h5>
              <p>${answer.text || answer.description || 'Answer'}</p>
              ${answer.upvoteCount ? `<span class="upvotes">👍 ${answer.upvoteCount}</span>` : ''}
            </div>
            `).join('')}
          </div>
          ` : ''}
        </div>
        `).join('')}
        ${standaloneAnswers.length > 0 ? `
        <div class="standalone-answers">
          <h4>Additional Answers:</h4>
          ${standaloneAnswers.map(answer => `
          <div class="answer">
            <h5>${this.formatAuthor(answer.author)}</h5>
            <p>${answer.text || answer.description || 'Answer'}</p>
          </div>
          `).join('')}
        </div>
        ` : ''}
      </div>
    </div>`;
  }

  private renderRatingsData(ratings: any[]): string {
    return `
    <div class="structured-data ratings-data">
      <h3>⭐ Ratings</h3>
      <div class="ratings-container">
        ${ratings.map(rating => `
        <div class="rating-item">
          <div class="rating-display">
            <span class="rating-value">${rating.ratingValue || 'N/A'}</span>
            ${rating.bestRating ? `<span class="rating-scale">/ ${rating.bestRating}</span>` : ''}
            ${rating.ratingCount ? `<span class="rating-count">(${rating.ratingCount} reviews)</span>` : ''}
          </div>
          ${rating.worstRating && rating.bestRating ? `
          <div class="rating-bar">
            <div class="rating-fill" style="width: ${((rating.ratingValue - rating.worstRating) / (rating.bestRating - rating.worstRating)) * 100}%"></div>
          </div>
          ` : ''}
        </div>
        `).join('')}
      </div>
    </div>`;
  }

  private renderNutritionData(nutritionItems: any[]): string {
    return `
    <div class="structured-data nutrition-data">
      <h3>🥗 Nutrition Information</h3>
      <div class="nutrition-container">
        ${nutritionItems.map(nutrition => `
        <div class="nutrition-item">
          <div class="nutrition-facts">
            ${nutrition.calories ? `<div class="nutrition-fact"><span class="label">Calories:</span> <span class="value">${nutrition.calories}</span></div>` : ''}
            ${nutrition.proteinContent ? `<div class="nutrition-fact"><span class="label">Protein:</span> <span class="value">${nutrition.proteinContent}</span></div>` : ''}
            ${nutrition.carbohydrateContent ? `<div class="nutrition-fact"><span class="label">Carbs:</span> <span class="value">${nutrition.carbohydrateContent}</span></div>` : ''}
            ${nutrition.fatContent ? `<div class="nutrition-fact"><span class="label">Fat:</span> <span class="value">${nutrition.fatContent}</span></div>` : ''}
            ${nutrition.fiberContent ? `<div class="nutrition-fact"><span class="label">Fiber:</span> <span class="value">${nutrition.fiberContent}</span></div>` : ''}
            ${nutrition.sugarContent ? `<div class="nutrition-fact"><span class="label">Sugar:</span> <span class="value">${nutrition.sugarContent}</span></div>` : ''}
            ${nutrition.sodiumContent ? `<div class="nutrition-fact"><span class="label">Sodium:</span> <span class="value">${nutrition.sodiumContent}</span></div>` : ''}
            ${nutrition.saturatedFatContent ? `<div class="nutrition-fact"><span class="label">Saturated Fat:</span> <span class="value">${nutrition.saturatedFatContent}</span></div>` : ''}
            ${nutrition.unsaturatedFatContent ? `<div class="nutrition-fact"><span class="label">Unsaturated Fat:</span> <span class="value">${nutrition.unsaturatedFatContent}</span></div>` : ''}
            ${nutrition.transFatContent ? `<div class="nutrition-fact"><span class="label">Trans Fat:</span> <span class="value">${nutrition.transFatContent}</span></div>` : ''}
          </div>
        </div>
        `).join('')}
      </div>
    </div>`;
  }

  private renderArticleData(article: any): string {
    return `
    <div class="structured-data article-data">
      <h3>📄 Article Information</h3>
      <div class="article-details">
        ${article.headline || article.name ? `<h4>${article.headline || article.name}</h4>` : ''}
        ${article.description ? `<p>${article.description}</p>` : ''}
        
        <div class="article-meta">
          ${article.author ? `<span class="author">✍️ ${this.formatAuthor(article.author)}</span>` : ''}
          ${article.datePublished ? `<span class="published">📅 ${new Date(article.datePublished).toLocaleDateString()}</span>` : ''}
          ${article.publisher ? `<span class="publisher">🏢 ${this.formatPublisher(article.publisher)}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  private renderProductData(product: any): string {
    return `
    <div class="structured-data product-data">
      <h3>🛍️ Product Information</h3>
      <div class="product-details">
        ${product.name ? `<h4>${product.name}</h4>` : ''}
        ${product.description ? `<p>${product.description}</p>` : ''}
        
        <div class="product-meta">
          ${product.brand ? `<span class="brand">🏷️ ${this.formatBrand(product.brand)}</span>` : ''}
          ${product.offers ? `<span class="price">💰 ${this.formatPrice(product.offers)}</span>` : ''}
          ${product.aggregateRating ? `<span class="rating">⭐ ${this.formatRating(product.aggregateRating)}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  private renderEntityData(entity: any): string {
    const type = entity['@type'];
    const icon = type === 'Person' ? '👤' : '🏢';
    
    return `
    <div class="structured-data entity-data">
      <h3>${icon} ${type} Information</h3>
      <div class="entity-details">
        ${entity.name ? `<h4>${entity.name}</h4>` : ''}
        ${entity.description ? `<p>${entity.description}</p>` : ''}
        ${entity.url ? `<p><a href="${entity.url}" target="_blank">🔗 Website</a></p>` : ''}
      </div>
    </div>`;
  }

  private renderEventData(event: any): string {
    return `
    <div class="structured-data event-data">
      <h3>📅 Event Information</h3>
      <div class="event-details">
        ${event.name ? `<h4>${event.name}</h4>` : ''}
        ${event.description ? `<p>${event.description}</p>` : ''}
        
        <div class="event-meta">
          ${event.startDate ? `<span class="start-date">🕐 Start: ${new Date(event.startDate).toLocaleString()}</span>` : ''}
          ${event.endDate ? `<span class="end-date">🕕 End: ${new Date(event.endDate).toLocaleString()}</span>` : ''}
          ${event.location ? `<span class="location">📍 ${this.formatLocation(event.location)}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  private renderGenericData(data: any): string {
    const type = data['@type'] || 'Data';
    return `
    <div class="structured-data generic-data">
      <h3>📊 ${type} Information</h3>
      <div class="generic-details">
        ${data.name ? `<h4>${data.name}</h4>` : ''}
        ${data.description ? `<p>${data.description}</p>` : ''}
        <details>
          <summary>View Raw Data</summary>
          <pre><code>${JSON.stringify(data, null, 2)}</code></pre>
        </details>
      </div>
    </div>`;
  }

  // Helper methods for formatting
  private formatDuration(duration: string): string {
    // Convert ISO 8601 duration to readable format
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (match) {
      const hours = match[1] ? `${match[1]}h ` : '';
      const minutes = match[2] ? `${match[2]}m` : '';
      return hours + minutes;
    }
    return duration;
  }

  private formatAuthor(author: any): string {
    if (typeof author === 'string') return author;
    if (author.name) return author.name;
    if (Array.isArray(author)) return author.map(a => this.formatAuthor(a)).join(', ');
    return 'Unknown';
  }

  private formatPublisher(publisher: any): string {
    if (typeof publisher === 'string') return publisher;
    if (publisher.name) return publisher.name;
    return 'Unknown';
  }

  private formatBrand(brand: any): string {
    if (typeof brand === 'string') return brand;
    if (brand.name) return brand.name;
    return 'Unknown';
  }

  private formatPrice(offers: any): string {
    if (Array.isArray(offers)) offers = offers[0];
    if (offers.price && offers.priceCurrency) {
      return `${offers.priceCurrency} ${offers.price}`;
    }
    if (offers.price) return offers.price;
    return 'Price available';
  }

  private formatRating(rating: any): string {
    if (rating.ratingValue && rating.bestRating) {
      return `${rating.ratingValue}/${rating.bestRating}`;
    }
    if (rating.ratingValue) return rating.ratingValue;
    return 'Rated';
  }

  private formatLocation(location: any): string {
    if (typeof location === 'string') return location;
    if (location.name) return location.name;
    if (location.address) {
      if (typeof location.address === 'string') return location.address;
      if (location.address.streetAddress) {
        return `${location.address.streetAddress}, ${location.address.addressLocality || ''}`;
      }
    }
    return 'Location available';
  }

  private generatePageTemplate(data: TemplateData): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.config.title}</title>
    <link rel="stylesheet" href="${data.config.relativePath}assets/style.css">
    <meta name="description" content="${data.config.description || 'Recipe collection from Basted Pocket'}">
</head>
<body>
    ${this.generatePageHeader(data.config)}
    
    <main class="container">
        ${data.config.showTagCloud && data.stats ? this.generateTagCloud(data.stats, data.config.relativePath) : ''}
        
        ${this.generateSearchSection(data.config)}
        
        ${this.generateArticlesSection(data.config)}
    </main>
    
    ${this.generateFooter(data.stats!)}
    
    <script>
        // Search data
        const searchData = ${JSON.stringify(data.searchData)};
        ${this.generateSearchScript()}
    </script>
</body>
</html>`;
  }

  private generatePageHeader(config: PageConfig): string {
    return `
    <header class="header">
        <div class="container">
            <a href="${config.relativePath}index.html" class="logo">👨‍🍳 Basted Pocket</a>
            <p class="tagline">Your Recipe Collection</p>
        </div>
    </header>`;
  }

  private generateSearchSection(config: PageConfig): string {
    return `
    <section class="search-section">
        <input type="text" id="searchInput" class="search-input" placeholder="${config.searchPlaceholder}">
        <div class="filters">
            <select id="tagFilter" class="filter-select">
                <option value="">All Tags</option>
                ${config.allTags.map(tag => `
                <option value="${tag}" ${config.selectedTag === tag ? 'selected' : ''}>${tag}</option>
                `).join('')}
            </select>
        </div>
    </section>`;
  }

  private generateTagCloud(stats: SiteData['stats'], relativePath: string): string {
    return `
    <section class="tag-cloud">
        <h2>Popular Tags</h2>
        <div class="tags">
            ${stats.topTags.slice(0, 20).map(({ tag, count }) => `
            <a href="${relativePath}tags/${tag}.html" class="tag">
                ${tag} <span class="count">${count}</span>
            </a>
            `).join('')}
        </div>
    </section>`;
  }

  private generateArticlesSection(config: PageConfig): string {
    const displayableArticles = config.articles.filter(a => this.isArticleDisplayable(a));
    
    return `
    <section class="articles-section">
        <div class="section-header">
            <h2>${config.heading}</h2>
            ${config.description ? `<p>${config.description}</p>` : ''}
        </div>
        
        <div class="articles-grid" id="articlesGrid">
            ${displayableArticles.length > 0 ? 
              displayableArticles.map(article => this.renderArticleCard(article, config.relativePath)).join('') :
              '<div class="no-results">No articles found matching your criteria.</div>'
            }
        </div>
    </section>`;
  }

  private generateFooter(stats: SiteData['stats']): string {
    return `
    <footer class="footer">
        <div class="container">
            <div class="footer-content">
                <div class="footer-stats">
                    <span class="stat">${stats.totalArticles} Articles</span>
                    <span class="stat">${stats.topTags.length} Tags</span>
                    <span class="stat">${stats.contentTypes.length} Content Types</span>
                </div>
                <div class="footer-tagline">
                    <p>Your Recipe Collection</p>
                </div>
            </div>
        </div>
    </footer>`;
  }

  private generateSearchScript(): string {
    return `
        // Search functionality
        const searchInput = document.getElementById('searchInput');
        const tagFilter = document.getElementById('tagFilter');
        const articlesGrid = document.getElementById('articlesGrid');
        
        function filterArticles() {
            const searchTerm = searchInput.value.toLowerCase();
            const selectedTag = tagFilter.value;
            
            const filteredData = searchData.filter(article => {
                const matchesSearch = !searchTerm || 
                    article.title.toLowerCase().includes(searchTerm) ||
                    article.summary.toLowerCase().includes(searchTerm) ||
                    article.content.toLowerCase().includes(searchTerm) ||
                    article.tags.some(tag => tag.toLowerCase().includes(searchTerm));
                
                const matchesTag = !selectedTag || article.tags.includes(selectedTag);
                
                return matchesSearch && matchesTag;
            });
            
            if (filteredData.length === 0) {
                articlesGrid.innerHTML = '<div class="no-results">No articles found matching your criteria.</div>';
                return;
            }
            
            articlesGrid.innerHTML = filteredData.map(article => \`
                <div class="article-card" data-tags="\${article.tags.join(',')}" data-type="\${article.type}">
                    <div class="card-layout">
                        \${article.imageUrl ? \`
                        <div class="card-thumbnail">
                            <a href="\${article.url}">
                                <img src="\${article.imageUrl}" alt="\${article.title}" loading="lazy">
                            </a>
                        </div>
                        \` : ''}
                        <div class="card-content">
                            <div class="card-header">
                                <h3><a href="\${article.url}">\${article.title}</a></h3>
                                <div class="card-meta">
                                </div>
                            </div>
                            \${article.summary ? \`<p class="summary">\${article.summary}</p>\` : ''}
                            \${article.tags.length > 0 ? \`
                            <div class="card-tags">
                                \${article.tags.map(tag => \`<a href="tags/\${tag}.html" class="tag">\${tag}</a>\`).join('')}
                            </div>
                            \` : ''}
                        </div>
                    </div>
                </div>
            \`).join('');
        }
        
        searchInput.addEventListener('input', filterArticles);
        tagFilter.addEventListener('change', filterArticles);
    `;
  }

  private cleanContentPreview(content: string, hasRecipes: boolean): string {
    if (!content) return '';
    
    // For recipe articles, only show the first few paragraphs before recipe content
    if (hasRecipes) {
      // Split into paragraphs and look for recipe indicators
      const paragraphs = content.split('\n').filter(p => p.trim());
      const cleanParagraphs: string[] = [];
      
      for (const paragraph of paragraphs) {
        const lowerPara = paragraph.toLowerCase();
        
        // Stop if we hit recipe content indicators
        if (lowerPara.includes('prep ') && lowerPara.includes('min') ||
            lowerPara.includes('cook ') && lowerPara.includes('min') ||
            lowerPara.includes('serves ') ||
            lowerPara.includes('makes ') ||
            lowerPara.includes('ingredients') ||
            lowerPara.includes('tbsp ') ||
            lowerPara.includes('tsp ') ||
            lowerPara.includes('ml ') ||
            lowerPara.includes('g ') && (lowerPara.includes('butter') || lowerPara.includes('flour') || lowerPara.includes('sugar')) ||
            lowerPara.includes('cloves') ||
            lowerPara.includes('defrosted') ||
            lowerPara.includes('finely chopped') ||
            lowerPara.includes('roughly chopped')) {
          break;
        }
        
        cleanParagraphs.push(paragraph);
        
        // Limit to first 3-4 paragraphs for recipe articles
        if (cleanParagraphs.length >= 3) break;
      }
      
      return cleanParagraphs.join('\n');
    }
    
    // For non-recipe articles, show more content but still limit it
    return content.split('\n').slice(0, 8).join('\n');
  }

  private renderArticleCard(article: ProcessedArticle, relativePath: string = '', maxTags: number = 0): string {
    const title = article.fetched_title || article.user_title || 'Untitled';
    const allTags = article.user_tags || [];
    const uniqueTags = [...new Set(allTags)];
    
    // Use local image if available, fallback to remote
    const imageUrl = this.getImageUrl(article, relativePath);
    const articleUrl = `${relativePath}articles/${article.id}.html`;

    // Show all tags - no more limiting
    const tagsToShow = uniqueTags;

    return `
    <div class="article-card" data-tags="${uniqueTags.join(',')}" data-type="article">
        <div class="card-layout">
            ${imageUrl ? `
            <div class="card-thumbnail">
                <a href="${articleUrl}">
                    <img src="${imageUrl}" alt="${title}" loading="lazy">
                </a>
            </div>
            ` : ''}
            <div class="card-content">
                <div class="card-header">
                    <h3><a href="${articleUrl}">${title}</a></h3>
                    <div class="card-meta">
                    </div>
                </div>
                ${article.main_text_content ? `<p class="summary">${article.main_text_content.substring(0, 200)}...</p>` : ''}
                ${uniqueTags.length > 0 ? `
                <div class="card-tags">
                    ${tagsToShow.map(tag => `<a href="${relativePath}tags/${tag}.html" class="tag">${tag}</a>`).join('')}
                </div>
                ` : ''}
            </div>
        </div>
    </div>`;
  }

  private async generateSearchData(data: SiteData): Promise<void> {
    const searchData = data.articles
      .filter(a => this.isArticleDisplayable(a))
      .map(article => ({
        id: article.id,
        title: article.fetched_title || article.user_title || 'Untitled',
        summary: article.main_text_content?.substring(0, 200) || '',
        content: article.main_text_content?.substring(0, 500) || '',
        tags: article.user_tags || [],
        keywords: [],
        type: 'article',
        url: `articles/${article.id}.html`,
        readTime: Math.max(1, Math.round((article.main_text_content?.split(/\s+/).length || 0) / 200)),
        imageUrl: this.getImageUrl(article)
      }));

    const dataDir = join(this.outputDir, 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    writeFileSync(
      join(dataDir, 'search.json'),
      JSON.stringify(searchData, null, 2)
    );
  }

  private async generateStaticAssets(): Promise<void> {
    const assetsDir = join(this.outputDir, 'assets');
    if (!existsSync(assetsDir)) {
      mkdirSync(assetsDir, { recursive: true });
    }

    // Generate CSS (same as before but simplified)
    const css = `
/* Basted Pocket Professional Styles */
:root {
  --primary-color: #d97706;
  --primary-light: #f59e0b;
  --primary-dark: #b45309;
  --secondary-color: #059669;
  --accent-color: #dc2626;
  --background: #ffffff;
  --surface: #f9fafb;
  --surface-elevated: #ffffff;
  --text-primary: #111827;
  --text-secondary: #4b5563;
  --text-muted: #9ca3af;
  --border: #d1d5db;
  --border-light: #e5e7eb;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px 0 rgb(0 0 0 / 0.06);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -1px rgb(0 0 0 / 0.06);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -2px rgb(0 0 0 / 0.05);
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 10px 10px -5px rgb(0 0 0 / 0.04);
  --radius-sm: 0.375rem;
  --radius: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Inter', sans-serif;
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--background);
  background-image: 
    radial-gradient(circle at 25% 25%, rgba(217, 119, 6, 0.02) 0%, transparent 50%),
    radial-gradient(circle at 75% 75%, rgba(5, 150, 105, 0.02) 0%, transparent 50%);
  font-feature-settings: 'kern' 1, 'liga' 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 0.5rem;
}

/* Header */
.header {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);
  color: white;
  padding: 1.5rem 0;
  margin-bottom: 2rem;
  box-shadow: var(--shadow-lg);
  position: relative;
}

.header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/><circle cx="50" cy="10" r="0.5" fill="white" opacity="0.1"/><circle cx="10" cy="60" r="0.5" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
  pointer-events: none;
}

.logo {
  font-size: 1.75rem;
  font-weight: 700;
  text-decoration: none;
  color: white;
  letter-spacing: -0.025em;
  position: relative;
  z-index: 1;
}

.tagline {
  margin-top: 0.5rem;
  opacity: 0.95;
  font-size: 1rem;
  font-weight: 400;
  position: relative;
  z-index: 1;
}

.header-nav {
  margin-top: 1rem;
  position: relative;
  z-index: 1;
}

.nav-link {
  color: white;
  text-decoration: none;
  padding: 0.75rem 1.5rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius);
  transition: all 0.2s ease;
  font-weight: 500;
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.1);
}

.nav-link:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.4);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Search Section */
.search-section {
  background: var(--surface-elevated);
  padding: 1.5rem;
  border-radius: var(--radius-lg);
  margin-bottom: 2rem;
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
}

.search-input {
  width: 100%;
  padding: 0.875rem 1rem;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  font-size: 1rem;
  margin-bottom: 1rem;
  transition: all 0.2s ease;
  background: var(--background);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.1);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.filters {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.filter-select {
  padding: 0.75rem 1rem;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  background: var(--background);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  transition: all 0.2s ease;
  cursor: pointer;
}

.filter-select:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.1);
}

/* Tag Cloud */
.tag-cloud {
  margin-bottom: 2rem;
  background: var(--surface-elevated);
  padding: 1.5rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
}

.tag-cloud h2 {
  margin-bottom: 1rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.875rem;
  background: var(--secondary-color);
  color: white;
  text-decoration: none;
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
}

.tag:hover {
  background: var(--primary-color);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.tag .count {
  opacity: 0.9;
  margin-left: 0.375rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.2);
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
}

/* Section Headers */
.section-header {
  margin-bottom: 2rem;
  text-align: center;
}

.section-header h2 {
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
  letter-spacing: -0.025em;
}

.section-header p {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
}

/* Articles Grid */
.articles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.article-card {
  background: var(--surface-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow);
  transition: all 0.3s ease;
  position: relative;
}

.article-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  transform: scaleX(0);
  transition: transform 0.3s ease;
}

.article-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-xl);
  border-color: var(--border);
}

.article-card:hover::before {
  transform: scaleX(1);
}

.card-layout {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  height: 100%;
}

.card-thumbnail {
  flex-shrink: 0;
  width: 100px;
  height: 75px;
  overflow: hidden;
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  position: relative;
}

.card-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
  border-radius: var(--radius);
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.article-card:hover .card-thumbnail img {
  transform: scale(1.05);
}

.card-content {
  flex: 1;
  padding: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
}

.card-header {
  margin-bottom: 0.5rem;
}

.card-content h3 {
  margin-bottom: 0.25rem;
  font-size: 1rem;
  line-height: 1.3;
  font-weight: 600;
}

.card-content h3 a {
  color: var(--text-primary);
  text-decoration: none;
  transition: color 0.2s ease;
}

.card-content h3 a:hover {
  color: var(--primary-color);
}

.summary {
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
  font-size: 0.8rem;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex-grow: 1;
}

.card-meta {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0;
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 500;
}

.card-meta span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: auto;
}

.card-tags .tag {
  font-size: 0.65rem;
  padding: 0.2rem 0.4rem;
  line-height: 1.2;
  background: var(--secondary-color);
  color: white;
  border-radius: var(--radius-sm);
  font-weight: 500;
  transition: all 0.2s ease;
}

.card-tags .tag:hover {
  background: var(--primary-color);
  color: white;
  transform: translateY(-1px);
}

.tag-more {
  font-size: 0.65rem;
  padding: 0.2rem 0.4rem;
  background: var(--text-muted);
  color: white;
  border-radius: var(--radius-sm);
  line-height: 1.2;
  font-weight: 500;
}

/* Page Header */
.page-header {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}

.page-header h1 {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

/* No Results */
.no-results {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
  font-style: italic;
}

/* Footer */
.footer {
  background: var(--surface-elevated);
  border-top: 1px solid var(--border-light);
  margin-top: 3rem;
  padding: 1.5rem 0;
}

.footer-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
  text-align: center;
}

.footer-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: center;
}

.footer-stats .stat {
  font-size: 0.875rem;
  color: var(--text-secondary);
  padding: 0.25rem 0.75rem;
  background: var(--background);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
}

.footer-tagline {
  color: var(--text-muted);
  font-size: 0.875rem;
}

.footer-tagline p {
  margin: 0;
}

@media (min-width: 768px) {
  .footer-content {
    flex-direction: row;
    justify-content: space-between;
    text-align: left;
  }
  
  .footer-stats {
    justify-content: flex-start;
  }
}

/* Responsive Design */
@media (max-width: 768px) {
  .container {
    padding: 0 1rem;
  }
  
  .articles-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  
  .filters {
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .card-layout {
    padding: 0.875rem;
    gap: 0.625rem;
  }
  
  .card-thumbnail {
    width: 80px;
    height: 60px;
  }
}

@media (max-width: 480px) {
  .container {
    padding: 0 0.75rem;
  }
  
  .card-layout {
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .card-thumbnail {
    width: 100%;
    height: 120px;
    align-self: stretch;
  }
  
  .filter-select {
    width: 100%;
  }
}

/* Structured Data Styles */
.structured-data {
  background: var(--surface-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: var(--shadow-sm);
}

.structured-data h3 {
  margin-bottom: 1rem;
  color: var(--text-primary);
  font-size: 1.125rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.structured-data h4 {
  margin-bottom: 0.75rem;
  color: var(--primary-color);
  font-size: 1rem;
  font-weight: 600;
}

.structured-data h5 {
  margin-bottom: 0.5rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Recipe Styles */
.recipe-description {
  color: var(--text-secondary);
  margin-bottom: 1rem;
  font-style: italic;
}

.recipe-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--background);
  border-radius: var(--radius);
  border: 1px solid var(--border-light);
}

.recipe-meta span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.recipe-ingredients,
.recipe-instructions {
  margin-bottom: 1.5rem;
}

.recipe-ingredients ul,
.recipe-instructions ol {
  margin-left: 1.5rem;
  margin-top: 0.5rem;
}

.recipe-ingredients li,
.recipe-instructions li {
  margin-bottom: 0.5rem;
  line-height: 1.5;
  color: var(--text-primary);
}

.recipe-instructions li {
  margin-bottom: 0.75rem;
}

.recipe-nutrition {
  background: var(--background);
  padding: 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-light);
}

.nutrition-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 0.5rem;
}

.nutrition-facts span {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

/* Article Detail Page Styles */
.article-detail {
  max-width: 800px;
  margin: 0 auto;
  background: var(--surface-elevated);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.article-header {
  padding: 2rem;
  border-bottom: 1px solid var(--border-light);
}

.article-header h1 {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 1rem;
  line-height: 1.2;
}

.article-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.5rem;
  color: var(--text-secondary);
}

.article-meta span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
}

.article-actions {
  display: flex;
  gap: 1rem;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: var(--primary-color);
  color: white;
  text-decoration: none;
  border-radius: var(--radius);
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
}

.btn-primary:hover {
  background: var(--primary-dark);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.article-image {
  padding: 0 2rem;
  margin-bottom: 2rem;
}

.article-image img {
  width: 100%;
  height: auto;
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}

.article-summary,
.article-content,
.structured-content,
.article-tags,
.article-notes,
.raw-structured-data {
  padding: 0 2rem 2rem;
}

.article-summary h2,
.article-content h2,
.article-tags h3,
.article-notes h3,
.raw-structured-data h3 {
  color: var(--text-primary);
  margin-bottom: 1rem;
  font-weight: 600;
}

.content-text {
  line-height: 1.7;
  color: var(--text-secondary);
}

.content-text p {
  margin-bottom: 1rem;
}

.article-tags .tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.raw-structured-data details {
  margin-top: 1rem;
}

.raw-structured-data summary {
  cursor: pointer;
  font-weight: 500;
  color: var(--primary-color);
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  transition: background-color 0.2s ease;
}

.raw-structured-data summary:hover {
  background: var(--border-light);
}

.raw-structured-data pre {
  background: var(--background);
  padding: 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-light);
  overflow-x: auto;
  font-size: 0.75rem;
  line-height: 1.4;
  margin-top: 0.5rem;
}

@media (max-width: 768px) {
  .article-header,
  .article-image,
  .article-summary,
  .article-content,
  .structured-content,
  .article-tags,
  .article-notes,
  .raw-structured-data {
    padding: 1rem;
  }
}
`;

    writeFileSync(join(this.outputDir, 'assets/style.css'), css);
    console.log('📄 Generated CSS stylesheet');
  }

  private async createDatasetZip(): Promise<void> {
    // Create download page
    const downloadHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Download Dataset - Basted Pocket</title>
    <link rel="stylesheet" href="assets/style.css">
</head>
<body>
    <header class="header">
        <div class="container">
            <a href="index.html" class="logo">👨‍🍳 Basted Pocket</a>
        </div>
    </header>

    <main class="container">
        <div class="page-header">
            <h1>📥 Download Dataset</h1>
            <p>Download the complete recipe dataset in various formats</p>
        </div>

        <div class="download-section">
            <div class="download-card">
                <h3>📊 Complete Dataset (JSON)</h3>
                <p>All articles with metadata, tags, and structured data</p>
                <a href="dataset.json" download="basted-pocket-dataset.json" class="btn-primary">
                    📄 Download JSON Dataset
                </a>
            </div>
        </div>

        <div class="usage-info">
            <h2>Usage Information</h2>
            <div class="info-grid">
                <div class="info-card">
                    <h4>Dataset Format</h4>
                    <p>The JSON dataset contains structured metadata for all articles including titles, tags, and JSON-LD structured data.</p>
                </div>
                <div class="info-card">
                    <h4>Source Data</h4>
                    <p>Complete source data including raw HTML content, scraped metadata, and downloaded images is available in the project's git repository under the archive/ directory.</p>
                </div>
                <div class="info-card">
                    <h4>Git Repository</h4>
                    <p>All data is version controlled and permanently stored in git, ensuring complete history and data integrity.</p>
                </div>
            </div>
        </div>
    </main>

    <footer class="footer">
        <div class="container">
            <div class="footer-content">
                <div class="footer-tagline">
                    <p>Your Recipe Collection</p>
                </div>
            </div>
        </div>
    </footer>
</body>
</html>`;
    
    writeFileSync(join(this.outputDir, 'download.html'), downloadHtml);
    console.log('📥 Generated download page');
    
    // Create dataset from current data
    await this.createDatasetFromCurrentData();
  }

  private async createDatasetFromCurrentData(): Promise<void> {
    try {
      // Load current articles from data directories
      const articles: ProcessedArticle[] = [];
      
      // Only load scraped files since we removed enrichment
      const dataDirs = [
        { dir: 'archive', type: 'scraped' }
      ];
      
      for (const { dir, type } of dataDirs) {
        if (existsSync(dir)) {
          const articleDirs = require('fs').readdirSync(dir);
          for (const articleDir of articleDirs) {
            const articlePath = `${dir}/${articleDir}`;
            const dataFile = `${articlePath}/data.json`;
            
            if (require('fs').statSync(articlePath).isDirectory() && existsSync(dataFile)) {
              try {
                const article = JSON.parse(readFileSync(dataFile, 'utf-8'));
                // Avoid duplicates
                if (!articles.find(a => a.id === article.id)) {
                  articles.push(article);
                }
              } catch (error) {
                console.warn(`⚠️  Could not load ${dataFile}:`, error);
              }
            }
          }
        }
      }

      // Create dataset
      const dataset = {
        metadata: {
          exported_at: new Date().toISOString(),
          total_articles: articles.length,
          format_version: "1.0",
          description: "Basted Pocket scraped recipe dataset"
        },
        articles: articles.map(article => ({
          id: article.id,
          original_url: article.original_url,
          canonical_url: article.canonical_url,
          user_title: article.user_title,
          user_tags: article.user_tags,
          user_notes: article.user_notes,
          fetched_title: article.fetched_title,
          scraping_timestamp: (article as any).scraping_timestamp,
          scraping_status: (article as any).scraping_status,
          json_ld_objects: article.json_ld_objects
        }))
      };

      writeFileSync(
        join(this.outputDir, 'dataset.json'),
        JSON.stringify(dataset, null, 2)
      );
      
      console.log(`📊 Generated dataset with ${articles.length} articles`);
    } catch (error) {
      console.warn('⚠️  Could not create dataset:', error);
    }
  }
}

async function main() {
  const generator = new BastesPocketSiteGenerator();
  await generator.generateFromScrapedData();
}

if (import.meta.main) {
  main().catch(console.error);
} 

