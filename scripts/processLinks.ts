#!/usr/bin/env bun

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * LinkHarbor Core Processing Script
 * Parses links.md and generates static HTML site
 */

interface Link {
  title: string;
  url: string;
  tags: string[];
  note?: string;
  section: string; // Year or custom section
  rawLine: string;
}

interface ProcessedData {
  links: Link[];
  tags: Record<string, Link[]>;
  sections: Record<string, Link[]>;
  stats: {
    totalLinks: number;
    totalTags: number;
    sectionsCount: number;
    topTags: Array<{ tag: string; count: number }>;
  };
}

class LinkHarbor {
  private outputDir: string;

  constructor(outputDir: string = 'dist') {
    this.outputDir = outputDir;
  }

  async processLinksFile(filePath: string = 'links.md'): Promise<ProcessedData> {
    console.log('🔄 Processing links.md...');
    
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const links: Link[] = [];
    let currentSection = 'Unsorted';
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('<!--') || trimmedLine.endsWith('-->')) {
        continue;
      }
      
      // Check for section headers (## Year or ## Section Name)
      if (trimmedLine.startsWith('## ')) {
        currentSection = trimmedLine.substring(3).trim();
        continue;
      }
      
      // Skip main title
      if (trimmedLine.startsWith('# ')) {
        continue;
      }
      
      // Parse link lines (- [Title](URL) #tag1 #tag2 @note:Note text)
      if (trimmedLine.startsWith('- ')) {
        const link = this.parseLink(trimmedLine, currentSection);
        if (link) {
          links.push(link);
        }
      }
    }
    
    console.log(`✅ Parsed ${links.length} links from ${Object.keys(this.groupBySection(links)).length} sections`);
    
    return this.processData(links);
  }

  private parseLink(line: string, section: string): Link | null {
    try {
      // Remove leading "- "
      const content = line.substring(2).trim();
      
      // Extract markdown link [Title](URL)
      const linkMatch = content.match(/^\[([^\]]*)\]\(([^)]+)\)/);
      if (!linkMatch) {
        console.warn(`⚠️  Could not parse link: ${line}`);
        return null;
      }
      
      const [, title, url] = linkMatch;
      const remainder = content.substring(linkMatch[0].length).trim();
      
      // Extract tags (#tag1 #tag2)
      const tags: string[] = [];
      const tagMatches = remainder.matchAll(/#(\w+)/g);
      for (const match of tagMatches) {
        tags.push(match[1]);
      }
      
      // Extract note (@note:Note text)
      let note: string | undefined;
      const noteMatch = remainder.match(/@note:(.+?)(?:\s|$)/);
      if (noteMatch) {
        note = noteMatch[1].replace(/_/g, ' ');
      }
      
      return {
        title: title || 'Untitled',
        url,
        tags,
        note,
        section,
        rawLine: line
      };
    } catch (error) {
      console.warn(`⚠️  Error parsing link: ${line} - ${error}`);
      return null;
    }
  }

  private processData(links: Link[]): ProcessedData {
    const tags = this.groupByTags(links);
    const sections = this.groupBySection(links);
    
    // Calculate top tags
    const tagCounts = Object.entries(tags).map(([tag, tagLinks]) => ({
      tag,
      count: tagLinks.length
    })).sort((a, b) => b.count - a.count);
    
    const stats = {
      totalLinks: links.length,
      totalTags: Object.keys(tags).length,
      sectionsCount: Object.keys(sections).length,
      topTags: tagCounts.slice(0, 20)
    };
    
    return { links, tags, sections, stats };
  }

  private groupByTags(links: Link[]): Record<string, Link[]> {
    const groups: Record<string, Link[]> = {};
    
    for (const link of links) {
      for (const tag of link.tags) {
        if (!groups[tag]) {
          groups[tag] = [];
        }
        groups[tag].push(link);
      }
    }
    
    return groups;
  }

  private groupBySection(links: Link[]): Record<string, Link[]> {
    const groups: Record<string, Link[]> = {};
    
    for (const link of links) {
      if (!groups[link.section]) {
        groups[link.section] = [];
      }
      groups[link.section].push(link);
    }
    
    return groups;
  }

  async generateSite(data: ProcessedData): Promise<void> {
    console.log('🏗️  Generating static site...');
    
    // Create output directory
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
    
    // Generate main index page
    await this.generateIndexPage(data);
    
    // Generate tag pages
    await this.generateTagPages(data);
    
    // Generate section pages
    await this.generateSectionPages(data);
    
    // Generate search data
    await this.generateSearchData(data);
    
    // Copy static assets
    await this.generateStaticAssets();
    
    console.log(`✅ Site generated in ${this.outputDir}/`);
  }

  private async generateIndexPage(data: ProcessedData): Promise<void> {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Basted Pocket - LinkHarbor</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>🍽️ Basted Pocket</h1>
        <p>A curated collection of recipes and food links</p>
        <nav>
            <a href="#stats">Stats</a>
            <a href="#tags">Tags</a>
            <a href="#sections">Sections</a>
            <a href="search.html">Search</a>
        </nav>
    </header>

    <main>
        <section id="stats">
            <h2>📊 Collection Stats</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>${data.stats.totalLinks}</h3>
                    <p>Total Links</p>
                </div>
                <div class="stat-card">
                    <h3>${data.stats.totalTags}</h3>
                    <p>Unique Tags</p>
                </div>
                <div class="stat-card">
                    <h3>${data.stats.sectionsCount}</h3>
                    <p>Sections</p>
                </div>
            </div>
        </section>

        <section id="tags">
            <h2>🏷️ Popular Tags</h2>
            <div class="tag-cloud">
                ${data.stats.topTags.map(({ tag, count }) => 
                    `<a href="tags/${tag}.html" class="tag" data-count="${count}">#${tag} (${count})</a>`
                ).join('')}
            </div>
        </section>

        <section id="sections">
            <h2>📚 Sections</h2>
            <div class="sections-grid">
                ${Object.entries(data.sections)
                    .sort(([a], [b]) => b.localeCompare(a)) // Sort sections (years) in descending order
                    .map(([section, links]) => `
                        <div class="section-card">
                            <h3><a href="sections/${section}.html">${section}</a></h3>
                            <p>${links.length} links</p>
                        </div>
                    `).join('')}
            </div>
        </section>

        <section id="recent">
            <h2>🆕 Recent Links</h2>
            <div class="links-list">
                ${data.links.slice(0, 10).map(link => this.renderLinkCard(link)).join('')}
            </div>
            <p><a href="sections/${Object.keys(data.sections)[0]}.html">View all recent links →</a></p>
        </section>
    </main>

    <footer>
        <p>Generated by LinkHarbor • Last updated: ${new Date().toLocaleDateString()}</p>
    </footer>
</body>
</html>`;

    writeFileSync(join(this.outputDir, 'index.html'), html);
  }

  private async generateTagPages(data: ProcessedData): Promise<void> {
    const tagsDir = join(this.outputDir, 'tags');
    if (!existsSync(tagsDir)) {
      mkdirSync(tagsDir, { recursive: true });
    }

    for (const [tag, links] of Object.entries(data.tags)) {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tag: #${tag} - Basted Pocket</title>
    <link rel="stylesheet" href="../styles.css">
</head>
<body>
    <header>
        <h1><a href="../index.html">🍽️ Basted Pocket</a></h1>
        <nav>
            <a href="../index.html">Home</a>
            <a href="../search.html">Search</a>
        </nav>
    </header>

    <main>
        <h2>🏷️ Tag: #${tag}</h2>
        <p>${links.length} links tagged with #${tag}</p>
        
        <div class="links-list">
            ${links.map(link => this.renderLinkCard(link)).join('')}
        </div>
    </main>

    <footer>
        <p><a href="../index.html">← Back to home</a></p>
    </footer>
</body>
</html>`;

      writeFileSync(join(tagsDir, `${tag}.html`), html);
    }
  }

  private async generateSectionPages(data: ProcessedData): Promise<void> {
    const sectionsDir = join(this.outputDir, 'sections');
    if (!existsSync(sectionsDir)) {
      mkdirSync(sectionsDir, { recursive: true });
    }

    for (const [section, links] of Object.entries(data.sections)) {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Section: ${section} - Basted Pocket</title>
    <link rel="stylesheet" href="../styles.css">
</head>
<body>
    <header>
        <h1><a href="../index.html">🍽️ Basted Pocket</a></h1>
        <nav>
            <a href="../index.html">Home</a>
            <a href="../search.html">Search</a>
        </nav>
    </header>

    <main>
        <h2>📚 Section: ${section}</h2>
        <p>${links.length} links in ${section}</p>
        
        <div class="links-list">
            ${links.map(link => this.renderLinkCard(link)).join('')}
        </div>
    </main>

    <footer>
        <p><a href="../index.html">← Back to home</a></p>
    </footer>
</body>
</html>`;

      writeFileSync(join(sectionsDir, `${section}.html`), html);
    }
  }

  private renderLinkCard(link: Link): string {
    return `
        <div class="link-card">
            <h3><a href="${link.url}" target="_blank" rel="noopener">${link.title}</a></h3>
            <p class="link-url">${new URL(link.url).hostname}</p>
            ${link.tags.length > 0 ? `
                <div class="link-tags">
                    ${link.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}
                </div>
            ` : ''}
            ${link.note ? `<p class="link-note">${link.note}</p>` : ''}
            <p class="link-section">From: ${link.section}</p>
        </div>
    `;
  }

  private async generateSearchData(data: ProcessedData): Promise<void> {
    // Generate search index for client-side search
    const searchData = {
      links: data.links.map(link => ({
        title: link.title,
        url: link.url,
        tags: link.tags,
        note: link.note,
        section: link.section
      })),
      tags: Object.keys(data.tags),
      sections: Object.keys(data.sections)
    };

    writeFileSync(join(this.outputDir, 'search-data.json'), JSON.stringify(searchData, null, 2));

    // Generate search page
    const searchHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Search - Basted Pocket</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1><a href="index.html">🍽️ Basted Pocket</a></h1>
        <nav>
            <a href="index.html">Home</a>
        </nav>
    </header>

    <main>
        <h2>🔍 Search Links</h2>
        <div class="search-container">
            <input type="text" id="searchInput" placeholder="Search titles, tags, or notes..." />
            <div id="searchResults"></div>
        </div>
    </main>

    <script src="search.js"></script>
</body>
</html>`;

    writeFileSync(join(this.outputDir, 'search.html'), searchHtml);
  }

  private async generateStaticAssets(): Promise<void> {
    // Generate CSS
    const css = `
/* Basted Pocket Styles */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #333;
    background-color: #fafafa;
}

header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 2rem 1rem;
    text-align: center;
}

header h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
}

header h1 a {
    color: white;
    text-decoration: none;
}

nav {
    margin-top: 1rem;
}

nav a {
    color: white;
    text-decoration: none;
    margin: 0 1rem;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    transition: background-color 0.3s;
}

nav a:hover {
    background-color: rgba(255, 255, 255, 0.2);
}

main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1rem;
}

section {
    margin-bottom: 3rem;
}

h2 {
    color: #2c3e50;
    margin-bottom: 1rem;
    font-size: 1.8rem;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
}

.stat-card {
    background: white;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    text-align: center;
}

.stat-card h3 {
    font-size: 2rem;
    color: #667eea;
    margin-bottom: 0.5rem;
}

.tag-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.tag {
    background: #e3f2fd;
    color: #1976d2;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    text-decoration: none;
    font-size: 0.9rem;
    transition: all 0.3s;
}

.tag:hover {
    background: #1976d2;
    color: white;
}

.sections-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1rem;
}

.section-card {
    background: white;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.section-card h3 a {
    color: #2c3e50;
    text-decoration: none;
}

.section-card h3 a:hover {
    color: #667eea;
}

.links-list {
    display: grid;
    gap: 1rem;
}

.link-card {
    background: white;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    border-left: 4px solid #667eea;
}

.link-card h3 {
    margin-bottom: 0.5rem;
}

.link-card h3 a {
    color: #2c3e50;
    text-decoration: none;
}

.link-card h3 a:hover {
    color: #667eea;
}

.link-url {
    color: #666;
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
}

.link-tags {
    margin: 0.5rem 0;
}

.link-tags .tag {
    margin-right: 0.5rem;
}

.link-note {
    color: #666;
    font-style: italic;
    margin: 0.5rem 0;
}

.link-section {
    color: #999;
    font-size: 0.8rem;
}

.search-container {
    max-width: 600px;
    margin: 0 auto;
}

#searchInput {
    width: 100%;
    padding: 1rem;
    font-size: 1.1rem;
    border: 2px solid #ddd;
    border-radius: 8px;
    margin-bottom: 2rem;
}

#searchInput:focus {
    outline: none;
    border-color: #667eea;
}

footer {
    background: #2c3e50;
    color: white;
    text-align: center;
    padding: 2rem;
    margin-top: 3rem;
}

footer a {
    color: #667eea;
    text-decoration: none;
}

@media (max-width: 768px) {
    header h1 {
        font-size: 2rem;
    }
    
    nav a {
        display: block;
        margin: 0.5rem 0;
    }
    
    .stats-grid {
        grid-template-columns: 1fr;
    }
}
`;

    writeFileSync(join(this.outputDir, 'styles.css'), css);

    // Generate search JavaScript
    const searchJs = `
// Client-side search functionality
let searchData = null;

async function loadSearchData() {
    try {
        const response = await fetch('search-data.json');
        searchData = await response.json();
    } catch (error) {
        console.error('Failed to load search data:', error);
    }
}

function performSearch(query) {
    if (!searchData || !query.trim()) {
        return [];
    }

    const lowerQuery = query.toLowerCase();
    
    return searchData.links.filter(link => {
        return link.title.toLowerCase().includes(lowerQuery) ||
               link.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
               (link.note && link.note.toLowerCase().includes(lowerQuery)) ||
               link.section.toLowerCase().includes(lowerQuery);
    });
}

function renderSearchResults(results) {
    const container = document.getElementById('searchResults');
    
    if (results.length === 0) {
        container.innerHTML = '<p>No results found.</p>';
        return;
    }
    
    container.innerHTML = results.map(link => \`
        <div class="link-card">
            <h3><a href="\${link.url}" target="_blank" rel="noopener">\${link.title}</a></h3>
            <p class="link-url">\${new URL(link.url).hostname}</p>
            \${link.tags.length > 0 ? \`
                <div class="link-tags">
                    \${link.tags.map(tag => \`<span class="tag">#\${tag}</span>\`).join('')}
                </div>
            \` : ''}
            \${link.note ? \`<p class="link-note">\${link.note}</p>\` : ''}
            <p class="link-section">From: \${link.section}</p>
        </div>
    \`).join('');
}

// Initialize search when page loads
document.addEventListener('DOMContentLoaded', async () => {
    await loadSearchData();
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const results = performSearch(e.target.value);
            renderSearchResults(results);
        });
    }
});
`;

    writeFileSync(join(this.outputDir, 'search.js'), searchJs);
  }
}

// CLI interface
if (import.meta.main) {
  const linksFile = process.argv[2] || 'links.md';
  const outputDir = process.argv[3] || 'dist';
  
  const harbor = new LinkHarbor(outputDir);
  
  try {
    const data = await harbor.processLinksFile(linksFile);
    await harbor.generateSite(data);
    
    console.log(`\n🎉 LinkHarbor site generated successfully!`);
    console.log(`📁 Output directory: ${outputDir}/`);
    console.log(`🌐 Open ${outputDir}/index.html in your browser to view the site`);
    
  } catch (error) {
    console.error(`❌ Error: ${error}`);
    process.exit(1);
  }
} 