#!/usr/bin/env bun

import { readFileSync, existsSync } from 'fs';
import { parseLinksMarkdown } from './parseLinks.ts';

interface PropertyAnalysis {
  count: number;
  examples: any[];
  types: Set<string>;
}

interface RecipeAnalysis {
  totalRecipes: number;
  properties: Map<string, PropertyAnalysis>;
  sampleRecipes: any[];
}

function analyzeRecipes(): RecipeAnalysis {
  console.log('🔍 Analyzing all recipe objects...');
  
  // Get fresh data from links.md
  const linksData = parseLinksMarkdown();
  console.log(`📖 Loaded ${linksData.length} links from links.md`);
  
  // Load scraped data
  const scrapedData = new Map<string, any>();
  
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
            scrapedData.set(scraped.id, scraped);
          } catch (error) {
            console.warn(`⚠️  Could not load ${dataFile}:`, error);
          }
        }
      }
    }
  }
  
  console.log(`📊 Loaded ${scrapedData.size} scraped articles`);
  
  // Analyze recipes
  const analysis: RecipeAnalysis = {
    totalRecipes: 0,
    properties: new Map(),
    sampleRecipes: []
  };
  
  // Process each article's JSON-LD data
  for (const [articleId, articleData] of scrapedData) {
    if (!articleData.json_ld_objects) continue;
    
    // Flatten and extract all objects
    const flattenedObjects = articleData.json_ld_objects.flat();
    const allObjects: any[] = [];
    
    for (const obj of flattenedObjects) {
      if (obj && obj['@graph']) {
        allObjects.push(...obj['@graph']);
      } else if (obj) {
        allObjects.push(obj);
      }
    }
    
    // Find recipe objects
    for (const obj of allObjects) {
      if (obj && obj['@type']) {
        const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
        
        if (types.includes('Recipe')) {
          analysis.totalRecipes++;
          
          // Store sample recipes for detailed inspection
          if (analysis.sampleRecipes.length < 10) {
            analysis.sampleRecipes.push({
              articleId,
              recipe: obj,
              url: articleData.canonical_url
            });
          }
          
          // Analyze all properties
          for (const [prop, value] of Object.entries(obj)) {
            if (!analysis.properties.has(prop)) {
              analysis.properties.set(prop, {
                count: 0,
                examples: [],
                types: new Set()
              });
            }
            
            const propAnalysis = analysis.properties.get(prop)!;
            propAnalysis.count++;
            
            // Store examples (limit to 3 per property)
            if (propAnalysis.examples.length < 3) {
              propAnalysis.examples.push({
                articleId,
                value: typeof value === 'object' ? JSON.stringify(value, null, 2) : value,
                url: articleData.canonical_url
              });
            }
            
            // Track value types
            if (Array.isArray(value)) {
              propAnalysis.types.add('array');
              if (value.length > 0) {
                const firstItem = value[0];
                if (typeof firstItem === 'object' && firstItem && firstItem['@type']) {
                  propAnalysis.types.add(`array<${firstItem['@type']}>`);
                } else {
                  propAnalysis.types.add(`array<${typeof firstItem}>`);
                }
              }
            } else if (typeof value === 'object' && value !== null) {
              const objValue = value as any;
              if (objValue['@type']) {
                propAnalysis.types.add(objValue['@type']);
              } else if (objValue['@id']) {
                propAnalysis.types.add('reference');
              } else {
                propAnalysis.types.add('object');
              }
            } else {
              propAnalysis.types.add(typeof value);
            }
          }
        }
      }
    }
  }
  
  return analysis;
}

function printAnalysis(analysis: RecipeAnalysis): void {
  console.log(`\n📊 Recipe Analysis Results:`);
  console.log(`   Total recipes found: ${analysis.totalRecipes}`);
  console.log(`   Unique properties: ${analysis.properties.size}`);
  
  // Sort properties by frequency
  const sortedProperties = Array.from(analysis.properties.entries())
    .sort(([,a], [,b]) => b.count - a.count);
  
  console.log(`\n🔍 Recipe Properties (sorted by frequency):`);
  console.log(`${'Property'.padEnd(25)} ${'Count'.padEnd(8)} ${'%'.padEnd(8)} Types`);
  console.log('─'.repeat(80));
  
  for (const [prop, data] of sortedProperties) {
    const percentage = ((data.count / analysis.totalRecipes) * 100).toFixed(1);
    const types = Array.from(data.types).join(', ');
    console.log(`${prop.padEnd(25)} ${data.count.toString().padEnd(8)} ${percentage.padEnd(7)}% ${types}`);
  }
  
  // Show properties we might not be rendering
  console.log(`\n🚨 Properties that might need renderers:`);
  const currentlyRendered = new Set([
    '@type', '@id', '@context', 'name', 'description', 'video', 'image',
    'prepTime', 'cookTime', 'totalTime', 'recipeYield', 'recipeIngredient',
    'recipeInstructions', 'nutrition', 'comment', 'author', 'datePublished',
    'aggregateRating', 'keywords', 'recipeCategory', 'recipeCuisine'
  ]);
  
  const unrenderedProperties = sortedProperties.filter(([prop]) => !currentlyRendered.has(prop));
  
  for (const [prop, data] of unrenderedProperties.slice(0, 20)) {
    const percentage = ((data.count / analysis.totalRecipes) * 100).toFixed(1);
    const types = Array.from(data.types).join(', ');
    console.log(`${prop.padEnd(25)} ${data.count.toString().padEnd(8)} ${percentage.padEnd(7)}% ${types}`);
    
    // Show example
    if (data.examples.length > 0) {
      const example = data.examples[0];
      const truncatedValue = example.value.length > 100 ? 
        example.value.substring(0, 100) + '...' : example.value;
      console.log(`   Example: ${truncatedValue}`);
      console.log(`   From: ${example.url}`);
    }
    console.log('');
  }
  
  // Show sample recipes for detailed inspection
  console.log(`\n📋 Sample Recipe Objects:`);
  for (let i = 0; i < Math.min(3, analysis.sampleRecipes.length); i++) {
    const sample = analysis.sampleRecipes[i];
    console.log(`\n--- Sample Recipe ${i + 1} (${sample.articleId}) ---`);
    console.log(`URL: ${sample.url}`);
    console.log(`Name: ${sample.recipe.name || 'Unnamed'}`);
    console.log(`Properties: ${Object.keys(sample.recipe).join(', ')}`);
    
    // Show interesting properties
    const interestingProps = ['recipeCategory', 'recipeCuisine', 'suitableForDiet', 'recipeYield', 'serves'];
    for (const prop of interestingProps) {
      if (sample.recipe[prop]) {
        console.log(`${prop}: ${JSON.stringify(sample.recipe[prop])}`);
      }
    }
  }
}

async function main() {
  const analysis = analyzeRecipes();
  printAnalysis(analysis);
}

if (import.meta.main) {
  main().catch(console.error);
} 