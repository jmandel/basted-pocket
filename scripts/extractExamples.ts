#!/usr/bin/env bun

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { parseLinksMarkdown } from './parseLinks.ts';

interface TypeExample {
  type: string;
  count: number;
  examples: any[];
  sources: string[];
}

class ExampleExtractor {
  private examples = new Map<string, TypeExample>();

  async extractExamples(): Promise<void> {
    console.log('🔍 Extracting examples of each JSON-LD type...\n');
    
    const scrapedDirs = [
      'archive'
    ];
    
    for (const dataDir of scrapedDirs) {
      if (existsSync(dataDir)) {
        const articleDirs = require('fs').readdirSync(dataDir);
        
        for (const articleDir of articleDirs) {
          const articlePath = `${dataDir}/${articleDir}`;
          const dataFile = `${articlePath}/data.json`;
          
          if (require('fs').statSync(articlePath).isDirectory() && existsSync(dataFile)) {
            try {
              const data = JSON.parse(readFileSync(dataFile, 'utf-8'));
              if (data.json_ld_objects && data.json_ld_objects.length > 0) {
                this.extractFromObjects(data.json_ld_objects, data.canonical_url || data.original_url);
              }
            } catch (error) {
              // Skip errors
            }
          }
        }
      }
    }
    
    this.saveExamples();
  }

  private extractFromObjects(jsonLdObjects: any[], sourceUrl: string): void {
    const flattenedObjects = this.deepFlatten(jsonLdObjects);
    
    for (const obj of flattenedObjects) {
      this.findAndExtractTypes(obj, sourceUrl);
    }
  }

  private findAndExtractTypes(obj: any, sourceUrl: string): void {
    if (!obj || typeof obj !== 'object') return;
    
    if (obj['@type']) {
      const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
      
      for (const type of types) {
        if (!this.examples.has(type)) {
          this.examples.set(type, {
            type,
            count: 0,
            examples: [],
            sources: []
          });
        }
        
        const example = this.examples.get(type)!;
        example.count++;
        
        if (!example.sources.includes(this.getDomain(sourceUrl))) {
          example.sources.push(this.getDomain(sourceUrl));
        }
        
        // Store up to 3 examples per type
        if (example.examples.length < 3) {
          example.examples.push({
            source: sourceUrl,
            data: this.cleanExample(obj)
          });
        }
      }
    }
    
    // Recursively search in all properties
    for (const [key, value] of Object.entries(obj)) {
      if (key === '@context') continue;
      
      if (Array.isArray(value)) {
        for (const item of value) {
          this.findAndExtractTypes(item, sourceUrl);
        }
      } else if (value && typeof value === 'object') {
        this.findAndExtractTypes(value, sourceUrl);
      }
    }
  }

  private deepFlatten(arr: any[]): any[] {
    const result: any[] = [];
    
    for (const item of arr) {
      if (Array.isArray(item)) {
        result.push(...this.deepFlatten(item));
      } else if (item && typeof item === 'object') {
        result.push(item);
      }
    }
    
    return result;
  }

  private getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  private cleanExample(obj: any): any {
    // Create a clean example with reasonable depth
    const cleaned: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (key === '@context') continue;
      
      if (typeof value === 'string') {
        cleaned[key] = value.length > 200 ? value.substring(0, 200) + '...' : value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        cleaned[key] = value;
      } else if (Array.isArray(value)) {
        if (value.length <= 3) {
          cleaned[key] = value.map(item => 
            typeof item === 'object' ? this.simplifyObject(item) : item
          );
        } else {
          cleaned[key] = `[${value.length} items]`;
        }
      } else if (value && typeof value === 'object') {
        cleaned[key] = this.simplifyObject(value);
      }
    }
    
    return cleaned;
  }

  private simplifyObject(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    
    const simplified: any = {};
    const keys = Object.keys(obj).slice(0, 5); // Limit to 5 properties
    
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string') {
        simplified[key] = value.length > 100 ? value.substring(0, 100) + '...' : value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        simplified[key] = value;
      } else {
        simplified[key] = '[object]';
      }
    }
    
    if (Object.keys(obj).length > 5) {
      simplified['...'] = `${Object.keys(obj).length - 5} more properties`;
    }
    
    return simplified;
  }

  private saveExamples(): void {
    // Sort by count descending
    const sortedExamples = Array.from(this.examples.values())
      .sort((a, b) => b.count - a.count);
    
    // Focus on the most valuable types for rendering
    const priorityTypes = [
      'Recipe', 'Review', 'Comment', 'NewsArticle', 'Article', 
      'VideoObject', 'AggregateRating', 'NutritionInformation',
      'Question', 'Answer', 'HowToStep', 'ImageObject'
    ];
    
    const output = {
      summary: {
        totalTypes: sortedExamples.length,
        totalOccurrences: sortedExamples.reduce((sum, ex) => sum + ex.count, 0),
        priorityTypes: priorityTypes.length
      },
      priorityExamples: sortedExamples
        .filter(ex => priorityTypes.includes(ex.type))
        .map(ex => ({
          type: ex.type,
          count: ex.count,
          sources: ex.sources,
          examples: ex.examples
        })),
      allTypes: sortedExamples.map(ex => ({
        type: ex.type,
        count: ex.count,
        sources: ex.sources.slice(0, 5), // Limit sources
        firstExample: ex.examples[0]?.data || null
      }))
    };
    
    writeFileSync('type-examples.json', JSON.stringify(output, null, 2));
    console.log(`✅ Extracted examples for ${sortedExamples.length} types`);
    console.log(`📊 Priority types found: ${output.priorityExamples.length}`);
    console.log(`💾 Saved to type-examples.json`);
    
    // Print priority types summary
    console.log('\n🎯 Priority Types for Rendering:');
    for (const ex of output.priorityExamples) {
      console.log(`   ${ex.type}: ${ex.count} occurrences from ${ex.sources.length} sources`);
    }
  }
}

async function main() {
  const extractor = new ExampleExtractor();
  await extractor.extractExamples();
}

if (import.meta.main) {
  main().catch(console.error);
} 