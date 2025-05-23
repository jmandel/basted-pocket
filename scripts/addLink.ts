#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'fs';

/**
 * Add Link Script
 * Adds a new link to links.md in the proper LinkHarbor format
 */

interface NewLink {
  title?: string;
  url: string;
  tags: string[];
  note?: string;
  section?: string;
}

class LinkAdder {
  private linksFile: string;

  constructor(linksFile: string = 'links.md') {
    this.linksFile = linksFile;
  }

  async addLink(newLink: NewLink): Promise<void> {
    console.log('📝 Adding new link to links.md...');
    
    // Read current content
    const content = readFileSync(this.linksFile, 'utf-8');
    const lines = content.split('\n');
    
    // Determine section (default to current year)
    const section = newLink.section || new Date().getFullYear().toString();
    
    // Format the new link
    const formattedLink = this.formatLink(newLink, section);
    
    // Find where to insert the link
    const insertIndex = this.findInsertionPoint(lines, section);
    
    // Insert the link
    lines.splice(insertIndex, 0, formattedLink);
    
    // Write back to file
    writeFileSync(this.linksFile, lines.join('\n'));
    
    console.log(`✅ Added link to section "${section}"`);
    console.log(`🔗 ${formattedLink}`);
  }

  private formatLink(link: NewLink, section: string): string {
    const title = link.title || this.extractTitleFromUrl(link.url);
    const tags = link.tags.map(tag => `#${tag.replace(/\s+/g, '_')}`).join(' ');
    const note = link.note ? ` @note:${link.note.replace(/\s+/g, '_')}` : '';
    
    return `- [${title}](${link.url})${tags ? ` ${tags}` : ''}${note}`;
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace('www.', '');
      const pathname = urlObj.pathname;
      
      // Try to extract a meaningful title from the URL
      if (pathname && pathname !== '/') {
        const pathParts = pathname.split('/').filter(Boolean);
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart) {
          return lastPart
            .replace(/[-_]/g, ' ')
            .replace(/\.(html?|php|aspx?)$/i, '')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        }
      }
      
      return hostname;
    } catch {
      return 'Untitled';
    }
  }

  private findInsertionPoint(lines: string[], targetSection: string): number {
    let sectionFound = false;
    let sectionStartIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for section headers
      if (line.startsWith('## ')) {
        const section = line.substring(3).trim();
        
        if (section === targetSection) {
          sectionFound = true;
          sectionStartIndex = i;
          continue;
        } else if (sectionFound) {
          // We've found the target section and now hit a different section
          // Insert before this new section
          return i;
        }
      }
    }
    
    if (sectionFound) {
      // Section exists, add at the end of the file
      return lines.length;
    } else {
      // Section doesn't exist, create it
      return this.createNewSection(lines, targetSection);
    }
  }

  private createNewSection(lines: string[], sectionName: string): number {
    // Find the best place to insert the new section
    // For years, insert in chronological order (newest first)
    const isYear = /^\d{4}$/.test(sectionName);
    
    if (isYear) {
      const targetYear = parseInt(sectionName);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('## ')) {
          const section = line.substring(3).trim();
          if (/^\d{4}$/.test(section)) {
            const year = parseInt(section);
            if (targetYear > year) {
              // Insert new section before this older year
              lines.splice(i, 0, `## ${sectionName}`, '');
              return i + 2;
            }
          }
        }
      }
    }
    
    // Default: add at the end
    lines.push('', `## ${sectionName}`, '');
    return lines.length;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
📝 Add Link to Basted Pocket

Usage:
  bun run scripts/addLink.ts <url> [options]

Options:
  --title "Title"           Custom title (auto-extracted if not provided)
  --tags "tag1,tag2"        Comma-separated tags
  --note "Note text"        Optional note
  --section "Section"       Section name (defaults to current year)

Examples:
  bun run scripts/addLink.ts "https://example.com/recipe" --tags "recipe,dinner" --title "Great Recipe"
  bun run scripts/addLink.ts "https://cooking.nytimes.com/recipes/123" --tags "recipe,asian,noodles" --note "Tried and loved it"
`);
    process.exit(0);
  }

  const url = args[0];
  const newLink: NewLink = {
    url,
    tags: [],
  };

  // Parse arguments
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--title':
        newLink.title = value;
        break;
      case '--tags':
        newLink.tags = value.split(',').map(tag => tag.trim()).filter(Boolean);
        break;
      case '--note':
        newLink.note = value;
        break;
      case '--section':
        newLink.section = value;
        break;
      default:
        console.warn(`⚠️  Unknown flag: ${flag}`);
    }
  }

  if (!newLink.url) {
    console.error('❌ Error: URL is required');
    process.exit(1);
  }

  try {
    const adder = new LinkAdder();
    await adder.addLink(newLink);
    
    console.log('\n🎉 Link added successfully!');
    console.log('💡 Run `bun run scripts/processLinks.ts` to regenerate the site');
    
  } catch (error) {
    console.error(`❌ Error: ${error}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
} 