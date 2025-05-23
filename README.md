# 🍽️ Basted Pocket

A **LinkHarbor**-powered read-it-later service specifically designed for recipe collections and food-related bookmarks. Transform your Pocket export into a beautiful, searchable static website.

## ✨ Features

- **📚 Import from Pocket**: Convert your existing Pocket CSV export into LinkHarbor format
- **🏗️ Static Site Generation**: Generate a beautiful, fast static website from your links
- **🔍 Full-Text Search**: Client-side search across titles, tags, and notes
- **🏷️ Tag-Based Organization**: Automatic tag pages and tag cloud visualization
- **📊 Analytics & Stats**: View statistics about your collection
- **📱 Responsive Design**: Works perfectly on desktop and mobile
- **⚡ Fast & Lightweight**: No database required, just static files
- **🎨 Beautiful UI**: Modern, clean design optimized for recipe browsing

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) JavaScript runtime
- Your Pocket CSV export file

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd basted-pocket

# Install dependencies
bun install
```

### Usage

#### 1. Import Your Pocket Data

First, export your Pocket data as CSV and place it in the project root:

```bash
# Convert Pocket CSV to LinkHarbor format
bun run import pocket.csv

# This creates links.md with all your bookmarks
```

#### 2. Generate Your AI-Enhanced Site

```bash
# Build the complete AI-enhanced static site
bun run build

# This runs three steps:
# 1. Scrape content from URLs (metadata, text, images)
# 2. Enrich content with AI (tags, summaries, keywords)
# 3. Generate static site with enhanced data
```

You can also run the steps individually:

```bash
# Step 1: Scrape content from URLs
bun run scrape

# Step 2: Enrich scraped content with AI
bun run enrich

# Step 3: Generate static site from enriched data  
bun run generate
```

**Note**: AI enrichment requires a `GEMINI_API_KEY` environment variable. Get your API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

#### Advanced Usage

**Incremental Processing**: The scraper automatically avoids re-processing existing content. To force refresh of older articles:

```bash
# Re-scrape content older than 30 days
bun run scrape:refresh 2024-01-01

# Re-enrich content older than 7 days (saves on API costs)
bun run enrich:refresh 2024-01-01

# Or run the individual scripts directly
bun run scripts/scrapeContent.ts --refresh-since 2024-01-01
bun run scripts/enrichContent.ts --refresh-since 2024-01-01
```

**Dataset Management**: Your processed data is automatically saved and can be downloaded:

```bash
# After building, visit your site's /download.html page
# Download the dataset.json file for backup

# To restore from a dataset, place dataset.json in dist/ folder
# The scraper will automatically detect and use existing data
```

#### 3. View Your Site

```bash
# Serve locally for testing
bun run serve

# Open http://localhost:8000 in your browser
```

#### 4. Add New Links

```bash
# Add a new link with tags and notes
bun run add "https://cooking.nytimes.com/recipes/123" --tags "recipe,asian,noodles" --title "Amazing Ramen Recipe" --note "Must try this weekend"

# Rebuild the site with AI enrichment
bun run build
```

## 📁 Project Structure

```
basted-pocket/
├── scripts/
│   ├── importPocket.ts    # Convert Pocket CSV to links.md
│   ├── processLinks.ts    # Generate static site from links.md
│   └── addLink.ts         # Add new links to links.md
├── src/
│   ├── types.ts           # TypeScript type definitions
│   ├── simple-parser.ts   # CSV parsing utilities
│   ├── analyzer.ts        # Link analysis and statistics
│   ├── exporter.ts        # Export utilities
│   └── cli-fixed.ts       # CLI interface
├── dist/                  # Generated static site
├── links.md              # Your links in LinkHarbor format
├── pocket.csv            # Your Pocket export (place here)
└── package.json
```

## 📝 LinkHarbor Format

Your links are stored in `links.md` using this format:

```markdown
# Basted Pocket Links

## 2025

- [Recipe Title](https://example.com/recipe) #recipe #dinner #asian @note:Tried_and_loved_it
- [Another Recipe](https://example.com/recipe2) #dessert #baking @note:Perfect_for_holidays

## 2024

- [Older Recipe](https://example.com/old-recipe) #recipe #soup #comfort
```

### Format Rules

- **Sections**: Organized by year (## YYYY) or custom sections
- **Links**: `- [Title](URL) #tag1 #tag2 @note:Optional_note`
- **Tags**: Use `#tagname` (spaces become underscores)
- **Notes**: Use `@note:text` (spaces become underscores)

## 🛠️ Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Import | `bun run import <csv-file>` | Convert Pocket CSV to links.md |
| Build | `bun run build` | Full pipeline: scrape + enrich + generate site |
| Scrape | `bun run scrape` | Scrape content from URLs (metadata, text, images) |
| Enrich | `bun run enrich` | Enrich scraped content with AI (tags, summaries) |
| Scrape (Refresh) | `bun run scrape:refresh YYYY-MM-DD` | Re-scrape articles since date |
| Enrich (Refresh) | `bun run enrich:refresh YYYY-MM-DD` | Re-enrich articles since date |
| Generate | `bun run generate` | Generate static site from enriched data |
| Add Link | `bun run add <url> [options]` | Add new link to collection |
| Serve | `bun run serve` | Serve site locally on port 8000 |
| Deploy | `bun run deploy` | Build and prepare for deployment |

### Add Link Options

```bash
bun run add "https://example.com" \
  --title "Custom Title" \
  --tags "tag1,tag2,tag3" \
  --note "Optional note" \
  --section "Custom Section"
```

## 🎨 Customization

### Styling

Edit the CSS in `scripts/processLinks.ts` in the `generateStaticAssets()` method to customize the appearance.

### Tags

The system automatically generates:
- **Tag pages**: Individual pages for each tag
- **Tag cloud**: Visual representation of popular tags
- **Tag statistics**: Count and usage analytics

### Search

Client-side search includes:
- Title matching
- Tag matching  
- Note content matching
- Section matching

## 🚀 Deployment

The generated `dist/` folder contains a complete static website that can be deployed to:

- **GitHub Pages**: Push the `dist/` folder to a `gh-pages` branch
- **Netlify**: Drag and drop the `dist/` folder
- **Vercel**: Deploy the `dist/` folder
- **Any static hosting**: Upload the `dist/` folder contents

### GitHub Pages with Actions (Recommended)

The repository includes a GitHub Actions workflow that automatically:
1. **Downloads existing data** from your GitHub Pages site to avoid re-processing
2. **Scrapes new content** only for articles older than 30 days
3. **Enriches content** with AI only for articles older than 7 days (saves API costs)
4. **Deploys the updated site** to GitHub Pages

To set up:

1. **Enable GitHub Pages** in your repository settings (Source: GitHub Actions)
2. **Add your Gemini API key** as a repository secret named `GEMINI_API_KEY`
3. **Push changes to `links.md`** - the workflow runs automatically
4. **Manual trigger** available via Actions tab for immediate updates

The workflow intelligently caches data between runs:
- Downloads `dataset.json` and `images.tar.gz` from your live site
- Only processes new or stale content
- Preserves all existing scraped data and images

### Manual GitHub Pages Example

```bash
# Build the site
bun run build

# Deploy to GitHub Pages (if set up manually)
git subtree push --prefix dist origin gh-pages
```

## 🤖 AI Enhancement Features

### Automatic Content Analysis
- **Content Scraping**: Extracts full text content from recipe URLs
- **Image Download**: Automatically downloads and stores key images locally
- **Metadata Extraction**: Pulls publication dates, authors, and structured data
- **JSON-LD Processing**: Extracts and renders structured data (recipes, articles, products)
- **AI-Powered Tagging**: Automatically generates relevant tags using Gemini AI
- **Smart Summaries**: Creates concise summaries of recipe content
- **Keyword Extraction**: Identifies key cooking terms and ingredients

### Enhanced Search & Display
- **Full-Text Search**: Search through scraped content, not just titles
- **Content Summaries**: Preview recipe content before visiting
- **AI-Generated Tags**: Discover recipes through automatically assigned tags
- **Rich Metadata**: Enhanced with publication dates, authors, and more
- **Structured Data Rendering**: Beautiful display of recipe ingredients, instructions, nutrition
- **Local Image Storage**: Fast loading with downloaded images stored locally

### Incremental Processing
- **Smart Caching**: Avoids re-processing already scraped content
- **Progress Preservation**: Saves each article immediately to prevent data loss
- **Selective Refresh**: Only re-process articles older than specified date
- **Cost Optimization**: Minimizes expensive LLM API calls
- **Separated Stages**: Scraping and AI enrichment run independently
- **Fault Tolerance**: If enrichment fails, scraped data is preserved

### Data Portability
- **Dataset Export**: Download complete processed dataset from your site
- **Backup & Restore**: Easily migrate between installations
- **Version Control**: Track processing timestamps and metadata
- **Incremental Updates**: Import existing datasets to avoid re-processing

### Configuration
- **Tag Definitions**: Customize AI tagging with `config/tags.json`
- **Content Processing**: Handles various content types (HTML, JSON-LD, etc.)
- **Error Handling**: Graceful fallbacks when scraping fails
- **GitHub Actions Caching**: Automatically downloads and reuses existing data from GitHub Pages to avoid re-processing

## 📊 Features Overview

### 🏠 Homepage
- Collection statistics with AI-enhanced metadata
- Popular tags cloud (including AI-generated tags)
- Recent links with content summaries
- Section navigation

### 🏷️ Tag Pages
- All links for a specific tag (user + AI tags)
- Tag-specific statistics
- Related tags and content summaries

### 📚 Section Pages
- Links organized by year or custom sections
- Chronological browsing with rich previews
- Section-specific stats and summaries

### 🔍 Search Page
- Real-time client-side search
- Search across titles, content, tags, and summaries
- Instant results with content previews

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- Inspired by the LinkHarbor concept for GitOps-powered link management
- Built with [Bun](https://bun.sh) for fast JavaScript runtime
- Designed specifically for recipe and food link collections

---

**Happy cooking and link collecting! 🍳📚**

## 🏗️ Data Architecture

LinkHarbor uses a **two-phase architecture** that separates expensive operations from cheap site generation:

### Phase 1: Expensive Data Collection (`build_output/data/`)
- **Web Scraping**: Downloads content, metadata, and images from URLs
- **AI Enrichment**: Generates tags, summaries, and keywords using LLM APIs
- **Flat File Storage**: Saves everything as individual JSON files + consolidated data
- **Archival**: Creates `data.tar.gz` for preservation and reuse

### Phase 2: Cheap Site Generation (`dist/`)
- **Fast Processing**: Reads from cached data files
- **Static Site**: Generates HTML, CSS, JS from processed data
- **No External Calls**: Pure file processing, runs in seconds

### Data Structure
```
build_output/data/
├── scraped/
│   └── articleId/
│       ├── data.json      # Scraped metadata and content
│       ├── content.html   # Raw HTML content
│       └── image.jpg      # Downloaded image
└── enriched/
    └── articleId/
        └── data.json      # Enriched data with AI tags/summaries
```

### Workflow Benefits
- **💰 Cost Efficient**: Reuse expensive LLM calls across runs
- **⚡ Fast Rebuilds**: Site generation takes seconds, not minutes
- **🔄 Incremental**: Only process new/stale content
- **📦 Portable**: Archive and restore entire datasets
- **🚀 CI/CD Friendly**: GitHub Actions downloads existing data automatically
