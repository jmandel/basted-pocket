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
  
  // AI enriched data
  auto_tags?: string[];
  summary?: string;
  keywords?: string[];
  read_time_minutes?: number;
  content_type?: string;
  processing_timestamp?: string;
  
  // Status tracking
  scraping_status?: 'scraped' | 'error_scraping' | 'skipped';
  enrichment_status?: 'enriched' | 'error_enrichment' | 'skipped';
  error?: string;
  llm_error?: string;
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

class BastesPocketSiteGenerator {
  private outputDir: string;

  constructor(outputDir: string = 'dist') {
    this.outputDir = outputDir;
  }

  private isArticleDisplayable(article: ProcessedArticle): boolean {
    // Article is displayable if it has been successfully scraped
    return article.scraping_status === 'scraped' || 
           article.enrichment_status === 'enriched';
  }

  private getImageUrl(article: ProcessedArticle, relativePath: string = ''): string | undefined {
    const localImagePath = (article as any).local_image_path;
    
    if (localImagePath) {
      // Convert from scraped/articleId/image.jpg to images/articleId_image.jpg
      const match = localImagePath.match(/scraped\/([^\/]+)\/(.+)/);
      if (match) {
        const [, articleId, filename] = match;
        return `${relativePath}images/${articleId}_${filename}`;
      }
    }
    
    // Fallback to remote image URL
    return article.key_image_url;
  }

  async generateFromEnrichedData(): Promise<void> {
    console.log('🔄 Merging fresh data from links.md with scraped content...');
    
    // Get fresh data from links.md
    const linksData = parseLinksMarkdown();
    console.log(`📖 Loaded ${linksData.length} links from links.md`);
    
    // Load scraped data
    const scrapedData = new Map<string, ScrapedData>();
    const enrichedData = new Map<string, any>();
    
    // Load scraped content
    const scrapedDirs = ['build_output/data/scraped', 'build_output/scraped'];
    for (const scrapedDir of scrapedDirs) {
      if (existsSync(scrapedDir)) {
        const articleDirs = require('fs').readdirSync(scrapedDir);
        for (const articleDir of articleDirs) {
          const articlePath = `${scrapedDir}/${articleDir}`;
          const dataFile = `${articlePath}/data.json`;
          
          if (require('fs').statSync(articlePath).isDirectory() && existsSync(dataFile)) {
            try {
              const scraped = JSON.parse(readFileSync(dataFile, 'utf-8'));
              scrapedData.set(scraped.id, scraped);
            } catch (error) {
              console.warn(`⚠️  Could not load ${dataFile}:`, error);
            }
          }
        }
      }
    }
    
    // Load enriched content
    const enrichedDirs = ['build_output/data/enriched', 'build_output/enriched'];
    for (const enrichedDir of enrichedDirs) {
      if (existsSync(enrichedDir)) {
        const articleDirs = require('fs').readdirSync(enrichedDir);
        for (const articleDir of articleDirs) {
          const articlePath = `${enrichedDir}/${articleDir}`;
          const dataFile = `${articlePath}/data.json`;
          
          if (require('fs').statSync(articlePath).isDirectory() && existsSync(dataFile)) {
            try {
              const enriched = JSON.parse(readFileSync(dataFile, 'utf-8'));
              enrichedData.set(enriched.id, enriched);
            } catch (error) {
              console.warn(`⚠️  Could not load ${dataFile}:`, error);
            }
          }
        }
      }
    }
    
    // Merge all data just-in-time
    const articles: ProcessedArticle[] = linksData.map(link => {
      const scraped = scrapedData.get(link.id);
      const enriched = enrichedData.get(link.id);
      
      // Merge data but ensure fresh links.md data takes precedence for user fields
      const merged = {
        ...scraped, // Scraped web content
        ...enriched, // AI enriched data
        ...link, // Fresh data from links.md - takes precedence
      };
      
      // Explicitly ensure user fields from links.md override any cached versions
      merged.user_tags = link.user_tags;
      merged.user_title = link.user_title;
      merged.user_notes = link.user_notes;
      
      // For auto_tags, preserve any AI-generated tags from enrichment
      if (enriched?.auto_tags && enriched.auto_tags.length > 0) {
        merged.auto_tags = enriched.auto_tags;
      }
      
      return merged;
    });
    
    console.log(`✅ Merged ${articles.length} articles`);
    console.log(`📊 Scraped: ${scrapedData.size}, Enriched: ${enrichedData.size}`);
    
    // Report on data completeness
    this.reportDataCompleteness(articles);
    
    const siteData = this.processSiteData(articles);
    await this.generateSite(siteData);
    await this.createDatasetZip();
  }

  private reportDataCompleteness(articles: ProcessedArticle[]): void {
    if (articles.length === 0) return;
    
    const scraped = articles.filter(a => (a as any).scraping_timestamp).length;
    const enriched = articles.filter(a => a.processing_timestamp).length;
    const withImages = articles.filter(a => (a as any).local_image_path || a.key_image_url).length;
    const withSummaries = articles.filter(a => a.summary).length;
    const withTags = articles.filter(a => a.auto_tags && a.auto_tags.length > 0).length;
    
    console.log('\n📊 Data Completeness Report:');
    console.log(`   Total articles: ${articles.length}`);
    console.log(`   Scraped content: ${scraped}/${articles.length} (${Math.round(scraped/articles.length*100)}%)`);
    console.log(`   AI enriched: ${enriched}/${articles.length} (${Math.round(enriched/articles.length*100)}%)`);
    console.log(`   With images: ${withImages}/${articles.length} (${Math.round(withImages/articles.length*100)}%)`);
    console.log(`   With summaries: ${withSummaries}/${articles.length} (${Math.round(withSummaries/articles.length*100)}%)`);
    console.log(`   With AI tags: ${withTags}/${articles.length} (${Math.round(withTags/articles.length*100)}%)`);
    
    if (scraped < articles.length) {
      console.log(`💡 ${articles.length - scraped} articles need scraping`);
    }
    if (enriched < articles.length) {
      console.log(`💡 ${articles.length - enriched} articles need AI enrichment`);
    }
    console.log('');
  }

  private processSiteData(articles: ProcessedArticle[]): SiteData {
    const tags = this.groupByTags(articles);
    const contentTypes = this.groupByContentType(articles);
    
    // Calculate statistics
    const processedArticles = articles.filter(a => this.isArticleDisplayable(a));
    const tagCounts = Object.entries(tags).map(([tag, tagArticles]) => ({
      tag,
      count: tagArticles.length
    })).sort((a, b) => b.count - a.count);
    
    const contentTypeCounts = Object.entries(contentTypes).map(([type, typeArticles]) => ({
      type,
      count: typeArticles.length
    })).sort((a, b) => b.count - a.count);
    
    const stats = {
      totalArticles: articles.length,
      processedArticles: processedArticles.length,
      totalTags: Object.keys(tags).length,
      topTags: tagCounts.slice(0, 20),
      contentTypes: contentTypeCounts
    };
    
    return { articles, tags, contentTypes, stats };
  }

  private groupByTags(articles: ProcessedArticle[]): Record<string, ProcessedArticle[]> {
    const groups: Record<string, ProcessedArticle[]> = {};
    
    for (const article of articles) {
      // Combine user tags and auto tags
      const allTags = [...(article.user_tags || []), ...(article.auto_tags || [])];
      const uniqueTags = [...new Set(allTags)];
      
      for (const tag of uniqueTags) {
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
      const type = article.content_type || 'unknown';
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
    
    // Copy images from build_output to dist
    await this.copyImages();
    
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

  private async copyImages(): Promise<void> {
    try {
      // Copy images from article directories
      const sourceDataDirs = ['build_output/data/scraped', 'build_output/scraped'];
      const destImagesDir = join(this.outputDir, 'images');
      
      if (!existsSync(destImagesDir)) {
        mkdirSync(destImagesDir, { recursive: true });
      }

      let copiedCount = 0;
      const copiedImages = new Set<string>(); // Track copied images to avoid duplicates

      for (const sourceDir of sourceDataDirs) {
        if (existsSync(sourceDir)) {
          const articleDirs = require('fs').readdirSync(sourceDir);
          
          for (const articleDir of articleDirs) {
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

      // Also handle old structure for backward compatibility
      const oldImagesDirs = ['build_output/data/images', 'build_output/images'];
      for (const oldImagesDir of oldImagesDirs) {
        if (existsSync(oldImagesDir)) {
          const files = require('fs').readdirSync(oldImagesDir);
          for (const file of files) {
            // Skip if already copied
            if (copiedImages.has(file)) {
              continue;
            }
            
            const sourcePath = join(oldImagesDir, file);
            const destPath = join(destImagesDir, file);
            
            try {
              const sourceContent = readFileSync(sourcePath);
              writeFileSync(destPath, sourceContent);
              copiedImages.add(file);
              copiedCount++;
            } catch (error) {
              console.warn(`Failed to copy image ${file}:`, error);
            }
          }
        }
      }

      console.log(`📷 Copied ${copiedCount} images to ${destImagesDir} (${copiedImages.size} unique images)`);
    } catch (error) {
      console.warn('Failed to copy images:', error);
    }
  }

  private async generateIndexPage(data: SiteData): Promise<void> {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Basted Pocket - Your Recipe Collection</title>
    <link rel="stylesheet" href="assets/style.css">
</head>
<body>
    <header class="header">
        <div class="container">
            <a href="index.html" class="logo">👨‍🍳 Basted Pocket</a>
            <nav class="header-nav">
                <a href="download.html" class="nav-link">📥 Download Dataset</a>
            </nav>
        </div>
    </header>

    <main class="container">
        <div class="search-section">
            <input type="text" id="searchInput" placeholder="Search recipes, summaries, tags..." class="search-input">
            <div class="filters">
                <select id="tagFilter" class="filter-select">
                    <option value="">All Tags</option>
                    ${data.stats.topTags.sort((a, b) => a.tag.localeCompare(b.tag)).map(({ tag, count }) => 
                        `<option value="${tag}">${tag} (${count})</option>`
                    ).join('')}
                </select>
            </div>
        </div>

        <div class="tag-cloud">
            <h2>Popular Tags</h2>
            <div class="tags">
                ${data.stats.topTags.slice(0, 15).map(({ tag, count }) => 
                    `<a href="tags/${tag}.html" class="tag" data-count="${count}">${tag} <span class="count">${count}</span></a>`
                ).join('')}
            </div>
        </div>

        <div class="articles-section">
            <div class="section-header">
                <h2>Recent Recipes</h2>
                <p>Discover your latest culinary adventures</p>
            </div>
            <div id="articlesContainer" class="articles-grid">
                ${data.articles
                  .filter(a => this.isArticleDisplayable(a))
                  .map(article => this.renderArticleCard(article))
                  .join('')}
            </div>
        </div>
    </main>

    <footer class="footer">
        <div class="container">
            <div class="footer-content">
                <div class="footer-stats">
                    <span class="stat">${data.stats.totalArticles} Total Articles</span>
                    <span class="stat">${data.stats.processedArticles} Processed</span>
                    <span class="stat">${data.stats.totalTags} Tags</span>
                    <span class="stat">${data.stats.contentTypes.length} Content Types</span>
                </div>
                <div class="footer-tagline">
                    <p>Your AI-Enhanced Recipe Collection</p>
                </div>
            </div>
        </div>
    </footer>

    <script src="assets/script.js"></script>
</body>
</html>`;

    writeFileSync(join(this.outputDir, 'index.html'), html);
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

  private renderJsonLdData(jsonLdObjects: any[]): string {
    if (!jsonLdObjects || jsonLdObjects.length === 0) return '';

    let renderedData = '';

    for (const obj of jsonLdObjects) {
      if (obj['@type']) {
        const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
        
        // Prioritize Recipe type if present
        if (types.includes('Recipe')) {
          renderedData += this.renderRecipeData(obj);
        } else if (types.includes('Article') || types.includes('NewsArticle') || types.includes('BlogPosting')) {
          renderedData += this.renderArticleData(obj);
        } else if (types.includes('Product')) {
          renderedData += this.renderProductData(obj);
        } else if (types.includes('Organization') || types.includes('Person')) {
          renderedData += this.renderEntityData(obj);
        } else if (types.includes('Event')) {
          renderedData += this.renderEventData(obj);
        } else {
          renderedData += this.renderGenericData(obj);
        }
      }
    }

    return renderedData;
  }

  private renderRecipeData(recipe: any): string {
    return `
    <div class="structured-data recipe-data">
      <h3>🍳 Recipe Information</h3>
      <div class="recipe-details">
        ${recipe.name ? `<h4>${recipe.name}</h4>` : ''}
        ${recipe.description ? `<p class="recipe-description">${recipe.description}</p>` : ''}
        
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

        ${recipe.recipeInstructions && recipe.recipeInstructions.length > 0 ? `
        <div class="recipe-instructions">
          <h5>Instructions:</h5>
          <ol>
            ${recipe.recipeInstructions.map((instruction: any) => {
              const text = typeof instruction === 'string' ? instruction : instruction.text || instruction.name || '';
              return `<li>${text}</li>`;
            }).join('')}
          </ol>
        </div>
        ` : ''}

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

  private generateArticlePage(article: ProcessedArticle): string {
    const title = article.fetched_title || article.user_title || 'Untitled';
    const allTags = [...(article.user_tags || []), ...(article.auto_tags || [])];
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
    <meta name="description" content="${article.summary || 'Recipe from Basted Pocket'}">
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
                    ${article.read_time_minutes ? `<span class="read-time">${article.read_time_minutes} min read</span>` : ''}
                    ${article.content_type ? `<span class="content-type">${article.content_type}</span>` : ''}
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

            ${article.summary ? `
            <div class="article-summary">
                <h2>Summary</h2>
                <p>${article.summary}</p>
            </div>
            ` : ''}

            ${article.json_ld_objects && article.json_ld_objects.length > 0 ? `
            <div class="structured-content">
                <h2>Structured Information</h2>
                ${this.renderJsonLdData(article.json_ld_objects)}
            </div>
            ` : ''}

            ${article.main_text_content ? `
            <div class="article-content">
                <h2>Content Preview</h2>
                <div class="content-text">
                    ${article.main_text_content.split('\n').map(p => p.trim() ? `<p>${p}</p>` : '').join('')}
                </div>
            </div>
            ` : ''}

            ${uniqueTags.length > 0 ? `
            <div class="article-tags">
                <h3>Tags</h3>
                <div class="tags">
                    ${uniqueTags.map(tag => `<a href="../tags/${tag}.html" class="tag">${tag}</a>`).join('')}
                </div>
            </div>
            ` : ''}

            ${article.keywords && article.keywords.length > 0 ? `
            <div class="article-keywords">
                <h3>Keywords</h3>
                <div class="keywords">
                    ${article.keywords.map(keyword => `<span class="keyword">${keyword}</span>`).join('')}
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

  private renderArticleCard(article: ProcessedArticle, relativePath: string = '', maxTags: number = 0): string {
    const title = article.fetched_title || article.user_title || 'Untitled';
    const allTags = [...(article.user_tags || []), ...(article.auto_tags || [])];
    const uniqueTags = [...new Set(allTags)];
    
    // Use local image if available, fallback to remote
    const imageUrl = this.getImageUrl(article, relativePath);
    const articleUrl = `${relativePath}articles/${article.id}.html`;

    // Handle tag display - show all tags if maxTags is 0, otherwise slice
    const tagsToShow = maxTags > 0 ? uniqueTags.slice(0, maxTags) : uniqueTags;
    const hasMoreTags = maxTags > 0 && uniqueTags.length > maxTags;

    return `
    <div class="article-card" data-tags="${uniqueTags.join(',')}" data-type="${article.content_type || ''}">
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
                        ${article.read_time_minutes ? `<span class="read-time">${article.read_time_minutes} min</span>` : ''}
                        ${article.content_type ? `<span class="content-type">${article.content_type}</span>` : ''}
                    </div>
                </div>
                ${article.summary ? `<p class="summary">${article.summary}</p>` : ''}
                ${uniqueTags.length > 0 ? `
                <div class="card-tags">
                    ${tagsToShow.map(tag => `<a href="${relativePath}tags/${tag}.html" class="tag">${tag}</a>`).join('')}
                    ${hasMoreTags ? `<span class="tag-more">+${uniqueTags.length - maxTags}</span>` : ''}
                </div>
                ` : ''}
            </div>
        </div>
    </div>`;
  }

  private async generateTagPages(data: SiteData): Promise<void> {
    const tagsDir = join(this.outputDir, 'tags');
    if (!existsSync(tagsDir)) {
      mkdirSync(tagsDir, { recursive: true });
    }

    for (const [tag, articles] of Object.entries(data.tags)) {
      const html = this.generateTagPage(tag, articles);
      writeFileSync(join(tagsDir, `${tag}.html`), html);
    }
  }

  private generateTagPage(tag: string, articles: ProcessedArticle[]): string {
    const processedArticles = articles.filter(a => this.isArticleDisplayable(a));
    
    // Get all unique tags and content types for filters
    const allTags = new Set<string>();
    const allTypes = new Set<string>();
    
    processedArticles.forEach(article => {
      [...(article.user_tags || []), ...(article.auto_tags || [])].forEach(t => allTags.add(t));
      if (article.content_type) allTypes.add(article.content_type);
    });
    
    const sortedTags = Array.from(allTags).sort();
    const sortedTypes = Array.from(allTypes).sort();
    
    // Create search data for this page
    const pageSearchData = processedArticles.map(article => ({
      id: article.id,
      title: article.fetched_title || article.user_title || 'Untitled',
      summary: article.summary || '',
      content: article.main_text_content?.substring(0, 500) || '',
      tags: [...(article.user_tags || []), ...(article.auto_tags || [])],
      keywords: article.keywords || [],
      type: article.content_type || '',
      url: '../articles/' + article.id + '.html',
      readTime: article.read_time_minutes || 0,
      imageUrl: this.getImageUrl(article, '../')
    }));
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tag: ${tag} - Basted Pocket</title>
    <link rel="stylesheet" href="../assets/style.css">
</head>
<body>
    <header class="header">
        <div class="container">
            <a href="../index.html" class="logo">👨‍🍳 Basted Pocket</a>
        </div>
    </header>

    <main class="container">
        <div class="page-header">
            <h1>Tag: ${tag}</h1>
            <p id="articleCount">${processedArticles.length} articles</p>
        </div>

        <div class="search-section">
            <input type="text" id="searchInput" placeholder="Search within ${tag} recipes..." class="search-input">
            <div class="filters">
                <select id="tagFilter" class="filter-select">
                    <option value="">All Tags</option>
                    ${sortedTags.map(t => 
                        `<option value="${t}" ${t === tag ? 'selected' : ''}>${t}</option>`
                    ).join('')}
                </select>
            </div>
        </div>

        <div id="articlesContainer" class="articles-grid">
            ${processedArticles.map(article => this.renderArticleCard(article, '../', 3)).join('')}
        </div>
        
        <div id="noResults" class="no-results" style="display: none;">
            <p>No recipes found matching your search criteria.</p>
        </div>
    </main>

    <script>
        // Page-specific search data
        window.pageArticles = ${JSON.stringify(pageSearchData)};
    </script>
    <script src="../assets/page-search.js"></script>
</body>
</html>`;
  }

  private async generateContentTypePages(data: SiteData): Promise<void> {
    const typesDir = join(this.outputDir, 'types');
    if (!existsSync(typesDir)) {
      mkdirSync(typesDir, { recursive: true });
    }

    for (const [type, articles] of Object.entries(data.contentTypes)) {
      const html = this.generateContentTypePage(type, articles);
      writeFileSync(join(typesDir, `${type}.html`), html);
    }
  }

  private generateContentTypePage(type: string, articles: ProcessedArticle[]): string {
    const processedArticles = articles.filter(a => this.isArticleDisplayable(a));
    
    // Get all unique tags and content types for filters
    const allTags = new Set<string>();
    const allTypes = new Set<string>();
    
    processedArticles.forEach(article => {
      [...(article.user_tags || []), ...(article.auto_tags || [])].forEach(t => allTags.add(t));
      if (article.content_type) allTypes.add(article.content_type);
    });
    
    const sortedTags = Array.from(allTags).sort();
    const sortedTypes = Array.from(allTypes).sort();
    
    // Create search data for this page
    const pageSearchData = processedArticles.map(article => ({
      id: article.id,
      title: article.fetched_title || article.user_title || 'Untitled',
      summary: article.summary || '',
      content: article.main_text_content?.substring(0, 500) || '',
      tags: [...(article.user_tags || []), ...(article.auto_tags || [])],
      keywords: article.keywords || [],
      type: article.content_type || '',
      url: '../articles/' + article.id + '.html',
      readTime: article.read_time_minutes || 0,
      imageUrl: this.getImageUrl(article, '../')
    }));
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Type: ${type} - Basted Pocket</title>
    <link rel="stylesheet" href="../assets/style.css">
</head>
<body>
    <header class="header">
        <div class="container">
            <a href="../index.html" class="logo">👨‍🍳 Basted Pocket</a>
        </div>
    </header>

    <main class="container">
        <div class="page-header">
            <h1>Content Type: ${type}</h1>
            <p id="articleCount">${processedArticles.length} articles</p>
        </div>

        <div class="search-section">
            <input type="text" id="searchInput" placeholder="Search within ${type} content..." class="search-input">
            <div class="filters">
                <select id="tagFilter" class="filter-select">
                    <option value="">All Tags</option>
                    ${sortedTags.map(t => 
                        `<option value="${t}">${t}</option>`
                    ).join('')}
                </select>
            </div>
        </div>

        <div id="articlesContainer" class="articles-grid">
            ${processedArticles.map(article => this.renderArticleCard(article, '../', 3)).join('')}
        </div>
        
        <div id="noResults" class="no-results" style="display: none;">
            <p>No content found matching your search criteria.</p>
        </div>
    </main>

    <script>
        // Page-specific search data
        window.pageArticles = ${JSON.stringify(pageSearchData)};
    </script>
    <script src="../assets/page-search.js"></script>
</body>
</html>`;
  }

  private async generateSearchData(data: SiteData): Promise<void> {
    const searchData = data.articles
      .filter(a => this.isArticleDisplayable(a))
      .map(article => ({
        id: article.id,
        title: article.fetched_title || article.user_title || 'Untitled',
        summary: article.summary || '',
        content: article.main_text_content?.substring(0, 500) || '',
        tags: [...(article.user_tags || []), ...(article.auto_tags || [])],
        keywords: article.keywords || [],
        type: article.content_type || '',
        url: `articles/${article.id}.html`,
        readTime: article.read_time_minutes || 0,
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

    // Generate CSS
    const css = `
/* Basted Pocket Professional Styles */
:root {
  --primary-color: #d97706;
  --primary-dark: #b45309;
  --primary-light: #fbbf24;
  --secondary-color: #374151;
  --accent-color: #059669;
  --background: #fefefe;
  --surface: #ffffff;
  --surface-elevated: #ffffff;
  --text-primary: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --border: #e5e7eb;
  --border-light: #f3f4f6;
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
  background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/><circle cx="50" cy="10" r="0.5" fill="white" opacity="0.1"/><circle cx="10" cy="60" r="0.5" fill="white" opacity="0.1"/><circle cx="90" cy="40" r="0.5" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
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

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.stat-card {
  background: var(--surface-elevated);
  padding: 1.5rem 1rem;
  border-radius: var(--radius-md);
  text-align: center;
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--primary-color), var(--primary-light));
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--border);
}

.stat-card h3 {
  font-size: 2rem;
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 0.5rem;
  line-height: 1;
}

.stat-card p {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
  background: var(--primary-color);
  color: white;
  text-decoration: none;
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
}

.tag:hover {
  background: var(--primary-dark);
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
  background: var(--primary-light);
  color: var(--primary-dark);
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

/* Article Detail */
.article-detail {
  max-width: 800px;
  margin: 0 auto;
}

.article-header {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}

.article-header h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  line-height: 1.2;
}

.article-meta {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  color: var(--text-secondary);
}

.article-actions {
  margin-top: 1rem;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.875rem 1.75rem;
  background: linear-gradient(135deg, var(--primary-color), var(--primary-dark));
  color: white;
  text-decoration: none;
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
  border: none;
  cursor: pointer;
}

.btn-primary:hover {
  background: linear-gradient(135deg, var(--primary-dark), var(--primary-color));
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.875rem 1.75rem;
  background: var(--surface-elevated);
  color: var(--text-primary);
  text-decoration: none;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.btn-secondary:hover {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.article-image {
  margin-bottom: 2rem;
}

.article-image img {
  width: 100%;
  border-radius: 8px;
}

.article-summary,
.article-content,
.article-tags,
.article-keywords,
.article-notes,
.structured-data {
  margin-bottom: 2rem;
}

.article-summary h2,
.article-content h2 {
  margin-bottom: 1rem;
  color: var(--primary-color);
}

.content-text {
  line-height: 1.8;
}

.content-text p {
  margin-bottom: 1rem;
}

.keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.keyword {
  padding: 0.25rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  font-size: 0.875rem;
}

/* Structured Data Styles */
.structured-content {
  margin-bottom: 2rem;
}

.structured-data {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.structured-data h3 {
  margin-bottom: 1rem;
  color: var(--primary-color);
  border-bottom: 2px solid var(--border);
  padding-bottom: 0.5rem;
}

.structured-data h4 {
  margin-bottom: 0.75rem;
  color: var(--text-primary);
}

.structured-data h5 {
  margin-bottom: 0.5rem;
  margin-top: 1rem;
  color: var(--text-primary);
  font-size: 1rem;
}

/* Recipe-specific styles */
.recipe-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 1rem 0;
  padding: 1rem;
  background: rgba(var(--primary-color), 0.05);
  border-radius: 6px;
}

.recipe-meta span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 500;
}

.recipe-ingredients ul,
.recipe-instructions ol {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.recipe-ingredients li,
.recipe-instructions li {
  margin-bottom: 0.5rem;
  line-height: 1.5;
}

.nutrition-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 0.5rem;
}

.nutrition-facts span {
  background: var(--border);
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.875rem;
}

/* Article data styles */
.article-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 1rem 0;
  color: var(--text-secondary);
}

.article-meta span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* Product data styles */
.product-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 1rem 0;
}

.product-meta span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 500;
}

/* Event data styles */
.event-meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 1rem 0;
}

.event-meta span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* Generic data styles */
.generic-details details {
  margin-top: 1rem;
}

.generic-details summary {
  cursor: pointer;
  padding: 0.5rem;
  background: var(--border);
  border-radius: 4px;
  font-weight: 500;
}

.generic-details pre {
  margin-top: 0.5rem;
  padding: 1rem;
  background: var(--surface);
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.875rem;
}

/* Raw structured data */
.raw-structured-data details {
  background: var(--surface);
  padding: 1rem;
  border-radius: 6px;
  border: 1px solid var(--border);
}

.raw-structured-data pre {
  margin-top: 1rem;
  overflow-x: auto;
  font-size: 0.875rem;
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

.load-more {
  text-align: center;
  margin-top: 2rem;
}

/* Download Page */
.download-section {
  margin-bottom: 2rem;
}

.download-card {
  background: var(--surface);
  padding: 2rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  text-align: center;
  max-width: 500px;
  margin: 0 auto;
}

.download-card h3 {
  margin-bottom: 1rem;
  color: var(--primary-color);
}

.download-card p {
  margin-bottom: 1.5rem;
  color: var(--text-secondary);
}

.download-note {
  margin-top: 1rem;
  font-size: 0.875rem;
}

.usage-info {
  background: var(--surface);
  padding: 2rem;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.usage-info h2 {
  margin-bottom: 1rem;
  color: var(--primary-color);
}

.usage-info ol {
  padding-left: 1.5rem;
}

.usage-info li {
  margin-bottom: 0.5rem;
}

.usage-info code {
  background: var(--border);
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  font-family: monospace;
}

/* No Results */
.no-results {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
  font-style: italic;
}

/* Responsive Design */
@media (max-width: 1024px) {
  .articles-grid {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }
}

@media (max-width: 768px) {
  .container {
    padding: 0 1rem;
  }
  
  .header {
    padding: 1.25rem 0;
    margin-bottom: 1.5rem;
  }
  
  .logo {
    font-size: 1.5rem;
  }
  
  .tagline {
    font-size: 0.875rem;
  }
  
  .articles-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  
  .filters {
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .article-header h1 {
    font-size: 1.75rem;
  }
  
  .article-meta {
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .card-layout {
    padding: 0.875rem;
    gap: 0.625rem;
  }
  
  .card-thumbnail {
    width: 80px;
    height: 60px;
  }
  
  .card-content h3 {
    font-size: 1rem;
  }
  
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }
  
  .stat-card {
    padding: 1.25rem 0.75rem;
  }
  
  .stat-card h3 {
    font-size: 1.75rem;
  }
  
  .search-section {
    padding: 1.25rem;
  }
  
  .tag-cloud {
    padding: 1.25rem;
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
  
  .stats-grid {
    grid-template-columns: 1fr;
  }
  
  .filters {
    gap: 0.5rem;
  }
  
  .filter-select {
    width: 100%;
  }
}

/* Loading States */
.loading {
  opacity: 0.6;
  pointer-events: none;
}

/* Focus Styles for Accessibility */
.tag:focus,
.nav-link:focus,
.btn-primary:focus,
.btn-secondary:focus {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
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

/* Print Styles */
@media print {
  .header-nav,
  .search-section,
  .filters,
  .load-more,
  .footer {
    display: none;
  }
  
  .article-card {
    break-inside: avoid;
    box-shadow: none;
    border: 1px solid #ccc;
  }
}
`;

    writeFileSync(join(this.outputDir, 'assets/style.css'), css);

    // Generate JavaScript
    const js = `
// Basted Pocket Search and Filter Functionality
class BastesPocketApp {
  constructor() {
    this.searchData = [];
    this.currentArticles = [];
    
    this.init();
  }

  async init() {
    await this.loadSearchData();
    this.setupEventListeners();
    this.displayArticles();
  }

  async loadSearchData() {
    try {
      const response = await fetch('data/search.json');
      this.searchData = await response.json();
      this.currentArticles = [...this.searchData];
    } catch (error) {
      console.error('Failed to load search data:', error);
    }
  }

  setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    const tagFilter = document.getElementById('tagFilter');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.handleSearch(e.target.value);
      });
    }

    if (tagFilter) {
      tagFilter.addEventListener('change', (e) => {
        this.handleFilter();
      });
    }
  }

  handleSearch(query) {
    const searchTerm = query.toLowerCase().trim();
    
    if (!searchTerm) {
      this.currentArticles = [...this.searchData];
    } else {
      this.currentArticles = this.searchData.filter(article => {
        return (
          article.title.toLowerCase().includes(searchTerm) ||
          article.summary.toLowerCase().includes(searchTerm) ||
          article.content.toLowerCase().includes(searchTerm) ||
          article.tags.some(tag => tag.toLowerCase().includes(searchTerm)) ||
          article.keywords.some(keyword => keyword.toLowerCase().includes(searchTerm))
        );
      });
    }
    
    this.handleFilter();
  }

  handleFilter() {
    const tagFilter = document.getElementById('tagFilter');
    
    let filtered = [...this.currentArticles];
    
    if (tagFilter && tagFilter.value) {
      filtered = filtered.filter(article => 
        article.tags.includes(tagFilter.value)
      );
    }
    
    this.currentArticles = filtered;
    this.displayArticles();
  }

  displayArticles() {
    const container = document.getElementById('articlesContainer');
    if (!container) return;

    container.innerHTML = this.currentArticles.map(article => this.renderArticleCard(article)).join('');
  }

  renderArticleCard(article) {
    return \`
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
              \${article.readTime ? \`<span class="read-time">\${article.readTime} min</span>\` : ''}
              \${article.type ? \`<span class="content-type">\${article.type}</span>\` : ''}
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
    </div>\`;
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new BastesPocketApp();
});
`;

    writeFileSync(join(this.outputDir, 'assets/script.js'), js);

    // Generate page-specific search script
    const pageSearchJs = `
// Page-specific search functionality for tag and content type pages
class PageSearch {
  constructor() {
    this.allArticles = window.pageArticles || [];
    this.currentArticles = [...this.allArticles];
    
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.updateDisplay();
  }

  setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    const tagFilter = document.getElementById('tagFilter');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.handleSearch();
      });
    }

    if (tagFilter) {
      tagFilter.addEventListener('change', (e) => {
        this.handleSearch();
      });
    }
  }

  handleSearch() {
    const searchInput = document.getElementById('searchInput');
    const tagFilter = document.getElementById('tagFilter');
    
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedTag = tagFilter ? tagFilter.value : '';
    
    let filtered = [...this.allArticles];
    
    // Apply text search
    if (searchTerm) {
      filtered = filtered.filter(article => {
        return (
          article.title.toLowerCase().includes(searchTerm) ||
          article.summary.toLowerCase().includes(searchTerm) ||
          article.content.toLowerCase().includes(searchTerm) ||
          article.tags.some(tag => tag.toLowerCase().includes(searchTerm)) ||
          article.keywords.some(keyword => keyword.toLowerCase().includes(searchTerm))
        );
      });
    }
    
    // Apply tag filter
    if (selectedTag) {
      filtered = filtered.filter(article => 
        article.tags.includes(selectedTag)
      );
    }
    
    this.currentArticles = filtered;
    this.updateDisplay();
  }

  updateDisplay() {
    const container = document.getElementById('articlesContainer');
    const countElement = document.getElementById('articleCount');
    const noResults = document.getElementById('noResults');
    
    if (!container) return;

    if (this.currentArticles.length === 0) {
      container.innerHTML = '';
      if (noResults) noResults.style.display = 'block';
    } else {
      container.innerHTML = this.currentArticles.map(article => this.renderArticleCard(article)).join('');
      if (noResults) noResults.style.display = 'none';
    }
    
    if (countElement) {
      countElement.textContent = \`\${this.currentArticles.length} articles\`;
    }
  }

  renderArticleCard(article) {
    return \`
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
              \${article.readTime ? \`<span class="read-time">\${article.readTime} min</span>\` : ''}
              \${article.type ? \`<span class="content-type">\${article.type}</span>\` : ''}
            </div>
          </div>
          \${article.summary ? \`<p class="summary">\${article.summary}</p>\` : ''}
          \${article.tags.length > 0 ? \`
          <div class="card-tags">
            \${article.tags.slice(0, 3).map(tag => \`<a href="../tags/\${tag}.html" class="tag">\${tag}</a>\`).join('')}
            \${article.tags.length > 3 ? \`<span class="tag-more">+\${article.tags.length - 3}</span>\` : ''}
          </div>
          \` : ''}
        </div>
      </div>
    </div>\`;
  }
}

// Initialize page search when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PageSearch();
});
`;

    writeFileSync(join(this.outputDir, 'assets/page-search.js'), pageSearchJs);
  }

  private async createDatasetFromCurrentData(): Promise<void> {
    try {
      // Load current articles from data directories
      const articles: ProcessedArticle[] = [];
      
      // Try enriched files first, then scraped files as fallback
      const dataDirs = [
        { dir: 'build_output/data/enriched', type: 'enriched' },
        { dir: 'build_output/enriched', type: 'enriched' },
        { dir: 'build_output/data/scraped', type: 'scraped' },
        { dir: 'build_output/scraped', type: 'scraped' }
      ];
      
      for (const { dir, type } of dataDirs) {
        if (existsSync(dir)) {
          const articleDirs = require('fs').readdirSync(dir);
          for (const articleDir of articleDirs) {
            const articlePath = `${dir}/${articleDir}`;
            const dataFile = `${articlePath}/data.json`;
            
            // Check if it's a directory and has data.json
            if (require('fs').statSync(articlePath).isDirectory() && existsSync(dataFile)) {
              try {
                const article = JSON.parse(readFileSync(dataFile, 'utf-8'));
                // Avoid duplicates (enriched takes precedence over scraped)
                if (!articles.find(a => a.id === article.id)) {
                  articles.push(article);
                }
              } catch (error) {
                console.warn(`⚠️  Could not load ${dataFile}:`, error);
              }
            }
            // Also handle old format (direct JSON files) for backward compatibility
            else if (articleDir.endsWith('.json')) {
              try {
                const article = JSON.parse(readFileSync(articlePath, 'utf-8'));
                // Avoid duplicates (enriched takes precedence over scraped)
                if (!articles.find(a => a.id === article.id)) {
                  articles.push(article);
                }
              } catch (error) {
                console.warn(`⚠️  Could not load ${articlePath}:`, error);
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
          description: "Basted Pocket scraped and enriched recipe dataset"
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
          scraping_timestamp: (article as any).scraping_timestamp,
          enrichment_timestamp: article.processing_timestamp,
          scraping_status: (article as any).scraping_status,
          enrichment_status: (article as any).enrichment_status,
          json_ld_objects: article.json_ld_objects
        }))
      };

      // Write dataset
      writeFileSync(join(this.outputDir, 'dataset.json'), JSON.stringify(dataset, null, 2));
      console.log(`📊 Created dataset with ${articles.length} articles`);
    } catch (error) {
      console.error('❌ Error creating dataset:', error);
    }
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
            <p>Access your complete recipe collection data</p>
        </div>

        <div class="download-section">
            <div class="download-card">
                <h3>📊 Complete Dataset (JSON)</h3>
                <p>All articles with metadata, tags, summaries, and structured data</p>
                <a href="dataset.json" download="basted-pocket-dataset.json" class="btn-primary">
                    📄 Download JSON Dataset
                </a>
            </div>

            <div class="download-card">
                <h3>🗂️ Complete Data Archive</h3>
                <p>All scraped content, images, and enriched data in organized folders</p>
                <a href="data.tar.gz" download="basted-pocket-data.tar.gz" class="btn-primary">
                    📦 Download Data Archive
                </a>
            </div>

            <div class="download-card">
                <h3>🖼️ Images Archive</h3>
                <p>All downloaded recipe images</p>
                <a href="images.tar.gz" download="basted-pocket-images.tar.gz" class="btn-primary">
                    🖼️ Download Images
                </a>
            </div>
        </div>

        <div class="usage-info">
            <h2>📖 Usage Information</h2>
            <div class="info-grid">
                <div class="info-card">
                    <h4>Dataset Format</h4>
                    <p>The JSON dataset contains structured metadata for all articles including titles, tags, summaries, and JSON-LD structured data.</p>
                </div>
                <div class="info-card">
                    <h4>Data Archive</h4>
                    <p>Complete backup including raw HTML content, scraped metadata, AI enrichments, and downloaded images organized by article ID.</p>
                </div>
                <div class="info-card">
                    <h4>GitHub Actions Integration</h4>
                    <p>The data archive can be used to restore state in GitHub Actions workflows, avoiding re-processing of existing content.</p>
                </div>
            </div>
        </div>
    </main>

    <footer class="footer">
        <div class="container">
            <div class="footer-content">
                <div class="footer-tagline">
                    <p>Your AI-Enhanced Recipe Collection</p>
                </div>
            </div>
        </div>
    </footer>
</body>
</html>`;

    writeFileSync(join(this.outputDir, 'download.html'), downloadHtml);
    
    // Create dataset from current data
    await this.createDatasetFromCurrentData();
  }

  private async createDataArchive(): Promise<void> {
    // Create data archive if data directory exists
    if (existsSync('build_output/data')) {
      try {
        await new Promise<void>((resolve, reject) => {
          const { spawn } = require('child_process');
          const tar = spawn('tar', ['-czf', join(this.outputDir, 'data.tar.gz'), '-C', 'build_output', 'data'], {
            stdio: 'inherit'
          });
          
          tar.on('close', (code: number) => {
            if (code === 0) {
              console.log('📦 Created data archive');
              resolve();
            } else {
              reject(new Error(`tar process exited with code ${code}`));
            }
          });
          
          tar.on('error', reject);
        });
      } catch (error) {
        console.warn('⚠️  Could not create data archive:', error);
      }
    }

    // Create images archive
    const imagesDir = join(this.outputDir, 'images');
    if (existsSync(imagesDir)) {
      try {
        await new Promise<void>((resolve, reject) => {
          const { spawn } = require('child_process');
          const tar = spawn('tar', ['-czf', join(this.outputDir, 'images.tar.gz'), '-C', this.outputDir, 'images'], {
            stdio: 'inherit'
          });
          
          tar.on('close', (code: number) => {
            if (code === 0) {
              console.log('🖼️  Created images archive');
              resolve();
            } else {
              reject(new Error(`tar process exited with code ${code}`));
            }
          });
          
          tar.on('error', reject);
        });
      } catch (error) {
        console.warn('⚠️  Could not create images archive:', error);
      }
    }
  }
}

async function main() {
  const generator = new BastesPocketSiteGenerator();
  await generator.generateFromEnrichedData();
}

if (import.meta.main) {
  main().catch(console.error);
} 
