#!/usr/bin/env bun

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { GoogleGenAI } from '@google/genai';
import { canonicalizeUrl, generateId } from './parseLinks.ts';
import { join } from 'path';

interface WaybackResponse {
  archived_snapshots: {
    closest?: {
      available: boolean;
      url: string;
      timestamp: string;
      status: string;
    };
  };
}

interface ResurrectedArticle {
  id: string;
  original_url: string;
  canonical_url: string;
  archived_url: string;
  fetched_title: string;
  main_text_content?: string;
  main_html_content?: string;
  key_image_url?: string;
  local_image_path?: string;
  json_ld_objects: any[];
  scraping_timestamp: string;
  scraping_status: 'scraped';
  resurrection_source: 'wayback_machine';
  resurrected: boolean;
}

class PageResurrector {
  private genai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    this.genai = new GoogleGenAI({ apiKey });
  }

  async fetchWaybackSnapshot(url: string): Promise<string> {
    console.log(`🔍 Fetching Wayback Machine snapshot for: ${url}`);
    
    const waybackApiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const response = await fetch(waybackApiUrl);
    
    if (!response.ok) {
      throw new Error(`Wayback API request failed: ${response.status}`);
    }
    
    const data = await response.json() as WaybackResponse;
    
    if (!data.archived_snapshots.closest?.available) {
      throw new Error(`No archived snapshot found for ${url}`);
    }
    
    const archivedUrl = data.archived_snapshots.closest.url;
    console.log(`📄 Found archived snapshot: ${archivedUrl}`);
    
    // Fetch the archived page content
    const archivedResponse = await fetch(archivedUrl);
    if (!archivedResponse.ok) {
      throw new Error(`Failed to fetch archived content: ${archivedResponse.status}`);
    }
    
    const htmlContent = await archivedResponse.text();
    return htmlContent;
  }

  async generateRecipeJsonLd(title: string, content: string): Promise<any[]> {
    try {
      console.log(`🤖 Generating recipe JSON-LD with Gemini AI...`);
      
      const prompt = `You are an expert data extraction and transformation AI. Your primary objective is to meticulously analyze the provided HTML source code of a recipe webpage and extract all pertinent recipe information. Subsequently, you must structure this extracted information into a clean, valid JSON-LD object adhering to the Schema.org/Recipe vocabulary.

**Extraction Strategy:**

1. **Prioritize Explicit Structured Data:**
   - First, thoroughly scan the HTML for any existing \`<script type="application/ld+json">\` tags containing recipe data. If found, this should be your primary source. Clean and use this data.
   - If direct JSON-LD is absent, search for Microdata (e.g., \`itemscope\`, \`itemtype="http://schema.org/Recipe"\`, \`itemprop\`) or RDFa attributes. If present, use this structured data.

2. **Semantic Content Inference (If no explicit structured data is found):**
   - If no explicit structured data (JSON-LD, Microdata, RDFa) exists, you must infer the recipe information from the overall content, layout, and semantic cues within the HTML.
   - Leverage your understanding of common web design patterns and how recipe information (like title, ingredients, preparation steps, cooking times, nutritional information, etc.) is typically presented and organized on websites.
   - Identify logical sections of the page that correspond to different aspects of a recipe.
   - Focus on the textual content and its context to determine its role (e.g., a list of items under a heading like "Ingredients" is likely the ingredient list).

**Target JSON-LD Fields (Schema.org/Recipe):**

Your output should be structured according to the \`Schema.org/Recipe\` vocabulary. **Aim to populate as many of the following properties as possible based on the information discoverable in the HTML.** Omit any field if the corresponding information is not present or cannot be reasonably and confidently inferred.

*   \`@context\`: "http://schema.org"
*   \`@type\`: "Recipe"
*   \`name\`: (String) The title of the recipe.
*   \`image\`: (String or Array of Strings/ImageObject) URL(s) of the primary image(s) for the recipe. If possible, provide an ImageObject with \`url\`, \`height\`, and \`width\`.
*   \`description\`: (String) A short summary or description of the recipe.
*   \`keywords\`: (String or Array of Strings) Keywords or tags associated with the recipe.
*   \`author\`: (Object: \`@type\`: "Person" or "Organization", \`name\`: String) The author or source of the recipe.
*   \`datePublished\`: (String: ISO 8601 date format, e.g., "2023-10-27") The publication date.
*   \`prepTime\`: (String: ISO 8601 duration format, e.g., "PT30M" for 30 minutes, "PT1H" for 1 hour).
*   \`cookTime\`: (String: ISO 8601 duration format).
*   \`totalTime\`: (String: ISO 8601 duration format). If only prep and cook time are available, you can calculate this if appropriate.
*   \`recipeYield\`: (String or QuantitativeValue) The quantity produced by the recipe (e.g., "6 servings", "12 cookies").
*   \`recipeCategory\`: (String or Array of Strings) The category of the recipe (e.g., "Dessert", "Main Course", "Appetizer").
*   \`recipeCuisine\`: (String or Array of Strings) The cuisine type (e.g., "Italian", "Mexican", "Asian").
*   \`recipeIngredient\`: (Array of Strings) A list of ingredient strings for the recipe.
*   \`recipeInstructions\`: (Array of Objects or Strings) Step-by-step instructions. Each instruction should be an object with \`@type\`: "HowToStep" and \`text\`: (instruction text). Alternatively, simple strings are acceptable.
*   \`nutrition\`: (Object: \`@type\`: "NutritionInformation") Nutritional information if available, with properties like \`calories\`, \`fatContent\`, \`proteinContent\`, etc.
*   \`aggregateRating\`: (Object: \`@type\`: "AggregateRating") Rating information if available, with \`ratingValue\`, \`reviewCount\`, etc.
*   \`review\`: (Array of Objects: \`@type\`: "Review") User reviews if available.

**Output Requirements:**

1. **Return ONLY a valid JSON array containing one or more JSON-LD objects.** Do not include any explanatory text, markdown formatting, or additional commentary.
2. **Each JSON-LD object must be a complete, valid Schema.org/Recipe object.**
3. **If multiple recipes are found on the page, include all of them in the array.**
4. **If no recipe content can be confidently identified, return an empty array: \`[]\`**

**Example Output Format:**
\`\`\`json
[
  {
    "@context": "http://schema.org",
    "@type": "Recipe",
    "name": "Classic Chocolate Chip Cookies",
    "image": "https://example.com/cookie-image.jpg",
    "description": "Delicious homemade chocolate chip cookies that are crispy on the outside and chewy on the inside.",
    "author": {
      "@type": "Person",
      "name": "Jane Smith"
    },
    "datePublished": "2023-10-27",
    "prepTime": "PT15M",
    "cookTime": "PT12M",
    "totalTime": "PT27M",
    "recipeYield": "24 cookies",
    "recipeCategory": "Dessert",
    "recipeCuisine": "American",
    "recipeIngredient": [
      "2 1/4 cups all-purpose flour",
      "1 tsp baking soda",
      "1 tsp salt",
      "1 cup butter, softened",
      "3/4 cup granulated sugar",
      "3/4 cup packed brown sugar",
      "2 large eggs",
      "2 tsp vanilla extract",
      "2 cups chocolate chips"
    ],
    "recipeInstructions": [
      {
        "@type": "HowToStep",
        "text": "Preheat oven to 375°F (190°C)."
      },
      {
        "@type": "HowToStep", 
        "text": "In a medium bowl, whisk together flour, baking soda, and salt."
      },
      {
        "@type": "HowToStep",
        "text": "In a large bowl, cream together butter and both sugars until light and fluffy."
      }
    ]
  }
]
\`\`\`

**HTML Content to Analyze:**
Title: ${title}

${content}`;

      const result = await this.genai.models.generateContent({
        model: 'gemini-2.5-flash-preview-05-20',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });
      const text = result.text;
      
      if (!text) {
        throw new Error('No text response from AI');
      }
      
      try {
        // Try to parse the response as JSON
        const jsonLdObjects = JSON.parse(text);
        
        if (!Array.isArray(jsonLdObjects)) {
          console.warn('AI response was not an array, wrapping in array');
          return [jsonLdObjects];
        }
        
        return jsonLdObjects;
      } catch (parseError) {
        console.warn('Failed to parse AI response as JSON:', parseError);
        console.log('Raw AI response:', text);
        
        // Try to extract JSON from the response if it's wrapped in markdown
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            const extractedJson = JSON.parse(jsonMatch[1]);
            return Array.isArray(extractedJson) ? extractedJson : [extractedJson];
          } catch (extractError) {
            console.warn('Failed to parse extracted JSON:', extractError);
          }
        }
        
        // Return empty array if we can't parse anything
        return [];
      }
    } catch (error) {
      console.error('Error generating recipe JSON-LD:', error);
      return [];
    }
  }

  extractTitle(htmlContent: string): string {
    // Try to extract title from HTML
    const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim();
    }
    
    // Fallback to h1 tag
    const h1Match = htmlContent.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      return h1Match[1].trim();
    }
    
    return 'Untitled Recipe';
  }

  extractMainImage(htmlContent: string, baseUrl: string): string | null {
    // Try to find main recipe image
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<img[^>]+class=["'][^"']*recipe[^"']*["'][^>]+src=["']([^"']+)["']/i,
      /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*recipe[^"']*["']/i,
      /<img[^>]+src=["']([^"']+)["'][^>]*>/i
    ];
    
    for (const pattern of patterns) {
      const match = htmlContent.match(pattern);
      if (match && match[1]) {
        let imageUrl = match[1];
        
        // Convert relative URLs to absolute
        if (imageUrl.startsWith('/')) {
          const urlObj = new URL(baseUrl);
          imageUrl = `${urlObj.protocol}//${urlObj.host}${imageUrl}`;
        } else if (!imageUrl.startsWith('http')) {
          imageUrl = new URL(imageUrl, baseUrl).href;
        }
        
        return imageUrl;
      }
    }
    
    return null;
  }

  async downloadImage(imageUrl: string, outputDir: string): Promise<string | null> {
    try {
      console.log(`📸 Downloading image: ${imageUrl}`);
      
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Determine file extension from content type or URL
      const contentType = response.headers.get('content-type');
      let extension = '.jpg'; // default
      
      if (contentType?.includes('png')) {
        extension = '.png';
      } else if (contentType?.includes('gif')) {
        extension = '.gif';
      } else if (contentType?.includes('webp')) {
        extension = '.webp';
      } else if (imageUrl.includes('.')) {
        const urlExtension = imageUrl.split('.').pop()?.toLowerCase();
        if (urlExtension && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(urlExtension)) {
          extension = `.${urlExtension}`;
        }
      }
      
      const imagePath = join(outputDir, `image${extension}`);
      writeFileSync(imagePath, buffer);
      
      console.log(`✅ Image saved: ${imagePath}`);
      return `image${extension}`;
    } catch (error) {
      console.error('Error downloading image:', error);
      return null;
    }
  }

  async resurrectPage(url: string): Promise<void> {
    try {
      console.log(`🔄 Resurrecting page: ${url}`);
      
      // Step 1: Fetch Wayback Machine snapshot
      const htmlContent = await this.fetchWaybackSnapshot(url);
      
      // Step 2: Extract basic information
      const canonicalUrl = canonicalizeUrl(url);
      const id = generateId(canonicalUrl);
      const title = this.extractTitle(htmlContent);
      
      console.log(`📝 Extracted title: ${title}`);
      console.log(`🆔 Generated ID: ${id}`);
      
      // Step 3: Generate JSON-LD with Gemini AI
      const jsonLdObjects = await this.generateRecipeJsonLd(title, htmlContent);
      
      if (jsonLdObjects.length === 0) {
        console.warn('⚠️  No recipe data could be extracted from the page');
      } else {
        console.log(`✅ Generated ${jsonLdObjects.length} JSON-LD object(s)`);
      }
      
      // Step 4: Create output directory
      const outputDir = join('archive', id);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      
      // Step 5: Try to extract and download main image
      const waybackResponse = await fetch(`http://archive.org/wayback/available?url=${encodeURIComponent(url)}`);
      const waybackData = await waybackResponse.json() as WaybackResponse;
      const archivedUrl = waybackData.archived_snapshots.closest?.url || url;
      
      const imageUrl = this.extractMainImage(htmlContent, archivedUrl);
      let localImagePath: string | null = null;
      
      if (imageUrl) {
        localImagePath = await this.downloadImage(imageUrl, outputDir);
      }
      
      // Step 6: Create the resurrected article data
      const resurrectedArticle: ResurrectedArticle = {
        id,
        original_url: url,
        canonical_url: canonicalUrl,
        archived_url: archivedUrl,
        fetched_title: title,
        main_html_content: htmlContent,
        key_image_url: imageUrl || undefined,
        local_image_path: localImagePath ? `archive/${id}/${localImagePath}` : undefined,
        json_ld_objects: jsonLdObjects,
        scraping_timestamp: new Date().toISOString(),
        scraping_status: 'scraped',
        resurrection_source: 'wayback_machine',
        resurrected: true
      };
      
      // Step 7: Save the data
      const dataPath = join(outputDir, 'data.json');
      writeFileSync(dataPath, JSON.stringify(resurrectedArticle, null, 2));
      
      console.log(`🎉 Successfully resurrected page and saved to: ${outputDir}`);
      console.log(`📄 Data file: ${dataPath}`);
      if (localImagePath) {
        console.log(`🖼️  Image file: ${join(outputDir, localImagePath)}`);
      }
      
    } catch (error) {
      console.error('❌ Error resurrecting page:', error);
      throw error;
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || !args[0]?.startsWith('--url')) {
    console.error('Usage: bun run resurrect --url <dead-url>');
    console.error('Example: bun run resurrect --url https://dead.link/123');
    process.exit(1);
  }
  
  const urlArg = args.find(arg => arg.startsWith('--url'));
  if (!urlArg) {
    console.error('❌ --url parameter is required');
    process.exit(1);
  }
  
  const url = urlArg.split('=')[1] || args[args.indexOf(urlArg) + 1];
  if (!url) {
    console.error('❌ URL value is required');
    process.exit(1);
  }
  
  try {
    const resurrector = new PageResurrector();
    await resurrector.resurrectPage(url);
  } catch (error) {
    console.error('❌ Resurrection failed:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.main) {
  main();
} 