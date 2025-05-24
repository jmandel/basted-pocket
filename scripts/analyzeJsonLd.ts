#!/usr/bin/env bun

import { readFileSync, existsSync } from 'fs';
import { parseLinksMarkdown } from './parseLinks.ts';

interface JsonLdAnalysis {
  type: string;
  count: number;
  examples: any[];
  properties: Set<string>;
  sources: Set<string>;
}

class JsonLdAnalyzer {
  private analysis = new Map<string, JsonLdAnalysis>();

  async analyzeAllData(): Promise<void> {
    console.log('🔍 Analyzing JSON-LD data across all articles...\n');
    
    // Get all articles from links.md
    const linksData = parseLinksMarkdown();
    console.log(`📖 Found ${linksData.length} articles to analyze\n`);
    
    // Load scraped data only since we removed enrichment
    const scrapedDirs = [
      'archive'
    ];
    let processedCount = 0;
    let totalJsonLdObjects = 0;
    let structureIssues = 0;
    
    for (const dataDir of scrapedDirs) {
      if (existsSync(dataDir)) {
        console.log(`📂 Checking ${dataDir}...`);
        const articleDirs = require('fs').readdirSync(dataDir);
        
        for (const articleDir of articleDirs) {
          const articlePath = `${dataDir}/${articleDir}`;
          const dataFile = `${articlePath}/data.json`;
          
          if (require('fs').statSync(articlePath).isDirectory() && existsSync(dataFile)) {
            try {
              const data = JSON.parse(readFileSync(dataFile, 'utf-8'));
              if (data.json_ld_objects && data.json_ld_objects.length > 0) {
                // Debug: Check structure
                const originalLength = data.json_ld_objects.length;
                const flattened = this.deepFlatten(data.json_ld_objects);
                const flattenedLength = flattened.length;
                
                if (originalLength !== flattenedLength) {
                  structureIssues++;
                  if (structureIssues <= 3) {
                    console.log(`🔍 Structure issue in ${articleDir}: ${originalLength} -> ${flattenedLength} objects after flattening`);
                  }
                }
                
                totalJsonLdObjects += flattenedLength;
                this.analyzeJsonLdObjects(data.json_ld_objects, data.canonical_url || data.original_url);
                processedCount++;
              }
            } catch (error) {
              console.warn(`⚠️  Could not load ${dataFile}:`, error);
            }
          }
        }
      }
    }
    
    console.log(`✅ Processed ${processedCount} articles with JSON-LD data`);
    console.log(`📊 Total JSON-LD objects found: ${totalJsonLdObjects}`);
    if (structureIssues > 0) {
      console.log(`⚠️  Found ${structureIssues} articles with nested array structures`);
    }
    console.log('');
    this.printAnalysis();
  }

  private analyzeJsonLdObjects(jsonLdObjects: any[], sourceUrl: string): void {
    // Recursively flatten deeply nested arrays
    const flattenedObjects = this.deepFlatten(jsonLdObjects);
    
    for (const obj of flattenedObjects) {
      // Recursively find all objects with @type, not just top-level
      this.findAndAnalyzeTypes(obj, sourceUrl);
    }
  }

  private findAndAnalyzeTypes(obj: any, sourceUrl: string): void {
    if (!obj || typeof obj !== 'object') return;
    
    // If this object has @type, analyze it
    if (obj['@type']) {
      const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
      
      for (const type of types) {
        // Keep original type, minimal normalization
        const normalizedType = this.normalizeType(type);
        
        if (!this.analysis.has(normalizedType)) {
          this.analysis.set(normalizedType, {
            type: normalizedType,
            count: 0,
            examples: [],
            properties: new Set(),
            sources: new Set()
          });
        }
        
        const analysis = this.analysis.get(normalizedType)!;
        analysis.count++;
        analysis.sources.add(this.getDomain(sourceUrl));
        
        // Collect properties
        Object.keys(obj).forEach(key => {
          if (key !== '@context' && key !== '@type') {
            analysis.properties.add(key);
          }
        });
        
        // Store examples (max 3 per type)
        if (analysis.examples.length < 3) {
          analysis.examples.push(this.sanitizeExample(obj));
        }
      }
    }
    
    // Recursively search in all properties
    for (const [key, value] of Object.entries(obj)) {
      if (key === '@context') continue; // Skip context
      
      if (Array.isArray(value)) {
        for (const item of value) {
          this.findAndAnalyzeTypes(item, sourceUrl);
        }
      } else if (value && typeof value === 'object') {
        this.findAndAnalyzeTypes(value, sourceUrl);
      }
    }
  }

  private deepFlatten(arr: any[]): any[] {
    const result: any[] = [];
    
    for (const item of arr) {
      if (Array.isArray(item)) {
        // Recursively flatten nested arrays
        result.push(...this.deepFlatten(item));
      } else if (item && typeof item === 'object') {
        result.push(item);
      }
    }
    
    return result;
  }

  private normalizeType(type: string): string {
    if (typeof type !== 'string') return String(type);
    
    // Very minimal normalization - just trim whitespace
    const normalized = type.trim();
    
    // Only handle the most obvious case: lowercase 'recipe' -> 'Recipe'
    if (normalized === 'recipe') {
      return 'Recipe';
    }
    
    // Return everything else as-is
    return normalized;
  }

  private getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  private sanitizeExample(obj: any): any {
    // Create a clean example with limited depth to avoid huge output
    const sanitized: any = { '@type': obj['@type'] };
    
    // Add key properties that are useful for understanding the type
    const keyProps = ['name', 'headline', 'description', 'url', 'image', 'author', 'datePublished', 'publisher'];
    
    for (const prop of keyProps) {
      if (obj[prop]) {
        if (typeof obj[prop] === 'string') {
          sanitized[prop] = obj[prop].length > 100 ? obj[prop].substring(0, 100) + '...' : obj[prop];
        } else if (typeof obj[prop] === 'object') {
          if (obj[prop].name) {
            sanitized[prop] = { name: obj[prop].name };
          } else if (Array.isArray(obj[prop])) {
            sanitized[prop] = `[${obj[prop].length} items]`;
          } else {
            sanitized[prop] = '[object]';
          }
        } else {
          sanitized[prop] = obj[prop];
        }
      }
    }
    
    return sanitized;
  }

  private printAnalysis(): void {
    // Sort by count descending
    const sortedTypes = Array.from(this.analysis.values())
      .sort((a, b) => b.count - a.count);
    
    console.log('📊 JSON-LD Type Analysis Results:');
    console.log('=' .repeat(80));
    
    for (const analysis of sortedTypes) {
      console.log(`\n🏷️  Type: ${analysis.type}`);
      console.log(`   Count: ${analysis.count} occurrences`);
      console.log(`   Sources: ${Array.from(analysis.sources).join(', ')}`);
      console.log(`   Properties (${analysis.properties.size} total): ${Array.from(analysis.properties).slice(0, 15).join(', ')}${analysis.properties.size > 15 ? '...' : ''}`);
      
      if (analysis.examples.length > 0) {
        console.log(`   Example structure:`);
        console.log(`   ${JSON.stringify(analysis.examples[0], null, 4).split('\n').map(line => '   ' + line).join('\n')}`);
      }
      
      // Show all properties if there are few enough
      if (analysis.properties.size <= 20) {
        console.log(`   All properties: ${Array.from(analysis.properties).sort().join(', ')}`);
      }
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log(`\n📈 Raw Statistics:`);
    console.log(`   Total unique types: ${sortedTypes.length}`);
    console.log(`   Most frequent type: ${sortedTypes[0]?.type} (${sortedTypes[0]?.count} occurrences)`);
    console.log(`   Types by frequency distribution:`);
    
    // Show frequency distribution
    const frequencyBuckets = [
      { min: 100, label: '100+' },
      { min: 50, label: '50-99' },
      { min: 20, label: '20-49' },
      { min: 10, label: '10-19' },
      { min: 5, label: '5-9' },
      { min: 2, label: '2-4' },
      { min: 1, label: '1' }
    ];
    
    for (const bucket of frequencyBuckets) {
      const typesInBucket = sortedTypes.filter(t => 
        t.count >= bucket.min && 
        (bucket.min === 100 || t.count < (frequencyBuckets.find(b => b.min > bucket.min)?.min || Infinity))
      );
      
      if (typesInBucket.length > 0) {
        console.log(`     ${bucket.label} occurrences: ${typesInBucket.length} types (${typesInBucket.map(t => t.type).join(', ')})`);
      }
    }
    
    console.log(`\n📊 Property Analysis:`);
    // Analyze which properties are most common across all types
    const allProperties = new Map<string, number>();
    for (const analysis of sortedTypes) {
      for (const prop of analysis.properties) {
        allProperties.set(prop, (allProperties.get(prop) || 0) + analysis.count);
      }
    }
    
    const sortedProperties = Array.from(allProperties.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    
    console.log(`   Most common properties across all types:`);
    for (const [prop, count] of sortedProperties) {
      console.log(`     ${prop}: ${count} total occurrences`);
    }
    
    console.log(`\n🌐 Source Analysis:`);
    const allSources = new Map<string, number>();
    for (const analysis of sortedTypes) {
      for (const source of analysis.sources) {
        allSources.set(source, (allSources.get(source) || 0) + analysis.count);
      }
    }
    
    const sortedSources = Array.from(allSources.entries())
      .sort((a, b) => b[1] - a[1]);
    
    console.log(`   JSON-LD usage by source:`);
    for (const [source, count] of sortedSources) {
      console.log(`     ${source}: ${count} total objects`);
    }
  }
}

async function main() {
  const analyzer = new JsonLdAnalyzer();
  await analyzer.analyzeAllData();
}

if (import.meta.main) {
  main().catch(console.error);
} 