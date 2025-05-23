#!/usr/bin/env bun

import { writeFileSync } from 'fs';
import { SimplePocketParser } from '../src/simple-parser.js';
import type { PocketBookmark } from '../src/types.js';

/**
 * Script to convert existing Pocket CSV export to links.md format
 * This bootstraps the LinkHarbor system with existing Pocket data
 */

async function convertPocketToLinksMarkdown(csvPath: string, outputPath: string = 'links.md'): Promise<void> {
  try {
    console.log('📚 Converting Pocket CSV to links.md format...');
    
    // Parse the existing Pocket CSV
    const bookmarks = await SimplePocketParser.parseCSV(csvPath);
    const validBookmarks = SimplePocketParser.filterValidBookmarks(bookmarks);
    
    console.log(`Found ${validBookmarks.length} valid bookmarks`);
    
    // Convert to links.md format
    let linksContent = '# Basted Pocket Links\n\n';
    linksContent += '<!-- Add new links here in the format: -->\n';
    linksContent += '<!-- - [Optional Title](https://example.com/url) #tag1 #tag2 @note:Optional note -->\n\n';
    
    // Group by year for better organization
    const bookmarksByYear = groupBookmarksByYear(validBookmarks);
    
    for (const [year, yearBookmarks] of Object.entries(bookmarksByYear).sort().reverse()) {
      linksContent += `## ${year}\n\n`;
      
      for (const bookmark of yearBookmarks) {
        const title = bookmark.title || 'Untitled';
        const url = bookmark.url;
        const tags = bookmark.tags.map((tag: string) => `#${tag.replace(/\s+/g, '_')}`).join(' ');
        const addedDate = new Date(bookmark.timeAdded * 1000).toISOString().split('T')[0];
        const note = `@note:Added_to_Pocket_on_${addedDate}`;
        
        // Format: - [Title](URL) #tag1 #tag2 @note:Added_to_Pocket_on_YYYY-MM-DD
        linksContent += `- [${title}](${url})`;
        if (tags) {
          linksContent += ` ${tags}`;
        }
        linksContent += ` ${note}\n`;
      }
      
      linksContent += '\n';
    }
    
    // Write the links.md file
    writeFileSync(outputPath, linksContent);
    
    console.log(`✅ Successfully created ${outputPath} with ${validBookmarks.length} links`);
    console.log(`📊 Breakdown by year:`);
    
    for (const [year, yearBookmarks] of Object.entries(bookmarksByYear).sort().reverse()) {
      console.log(`   ${year}: ${yearBookmarks.length} links`);
    }
    
  } catch (error) {
    console.error(`❌ Error converting Pocket data: ${error}`);
    process.exit(1);
  }
}

function groupBookmarksByYear(bookmarks: PocketBookmark[]): Record<string, PocketBookmark[]> {
  const groups: Record<string, PocketBookmark[]> = {};
  
  for (const bookmark of bookmarks) {
    const year = new Date(bookmark.timeAdded * 1000).getFullYear().toString();
    if (!groups[year]) {
      groups[year] = [];
    }
    groups[year].push(bookmark);
  }
  
  // Sort bookmarks within each year by date (newest first)
  for (const year in groups) {
    groups[year].sort((a, b) => b.timeAdded - a.timeAdded);
  }
  
  return groups;
}

// Run the script if called directly
if (import.meta.main) {
  const csvPath = process.argv[2];
  const outputPath = process.argv[3] || 'links.md';
  
  if (!csvPath) {
    console.error('Usage: bun run scripts/importPocket.ts <csv-file> [output-file]');
    process.exit(1);
  }
  
  await convertPocketToLinksMarkdown(csvPath, outputPath);
} 