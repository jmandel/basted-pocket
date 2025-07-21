# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Basted Pocket is an AI-enhanced recipe collection system - a GitOps-powered read-it-later service that transforms Pocket exports into a searchable static website with AI-powered content enrichment.

## Key Commands

### Development Workflow
- `bun run build` - Full pipeline: scrape new content + generate static site
- `bun run scrape` - Scrape only new content (skips already-scraped URLs)
- `bun run generate` - Generate static site from scraped data
- `bun run serve` - Serve site locally on port 8000-8002
- `bun run add <url> [options]` - Add new link to collection

### Data Management
- `bun run import` - Convert Pocket CSV to links.md format
- `bun run scrape:refresh YYYY-MM-DD` - Force re-scrape articles older than specified date
- `bun run resurrect --url <dead-url>` - Resurrect dead pages using Wayback Machine
- `bun run clean` - Remove all generated files

## Architecture

### Git-Based Data Storage
- All scraped content permanently stored in `archive/` directory under version control
- Each article gets unique directory: `archive/articleId/` containing:
  - `data.json` - Scraped metadata and content
  - `content.html` - Raw HTML content
  - `image.jpg` - Downloaded image
  - `archive.pdf` - PDF archive (optional)

### Core Scripts
- `scripts/parseLinks.ts` - Parses links.md markdown format into structured data
- `scripts/scrapeContent.ts` - Web scraping with Playwright for content extraction
- `scripts/generateSite.ts` - Static site generation from scraped data
- `scripts/addLink.ts` - CLI for adding new links to collection

### Data Flow
1. Links stored in `links.md` with format: `- [Title](URL) #tag1 #tag2 @note:Optional_note`
2. Scraping extracts content, metadata, images, and JSON-LD structured data
3. Site generation merges link data with scraped content to create static HTML

### Key Features
- **Incremental Processing**: Only processes new content, preserves existing scraped data
- **Smart Failure Handling**: Tracks failure counts, implements cooldown periods, manages permanently failed URLs
- **Content Enrichment**: Extracts article text, images, publication dates, authors
- **Structured Data**: Processes JSON-LD for recipe cards, nutrition info
- **AI Tagging**: Enhanced with AI-generated tags via config/tags.json
- **Full-Text Search**: Client-side search across all content

## Development Notes

### Dependencies
- **Bun** runtime for TypeScript execution
- **Playwright** (optional) for web scraping
- **@google/genai** for AI features
- **commander**, **chalk** for CLI tools

### File Organization
- Links organized by year sections in `links.md`
- Tags support both manual (#tagname) and AI-generated
- Notes format: `@note:text` (spaces become underscores)

### Testing & Deployment
- No explicit test framework found - manually verify with `bun run serve`
- GitHub Actions workflow handles automated deployment to GitHub Pages
- Site builds are atomic and preserve data integrity

### Failure Handling System
- **Failure Counting**: Tracks failure attempts per URL (max 5 failures)
- **Cooldown Periods**: 7-day cooldown between retry attempts for failed URLs
- **Permanent Failures**: URLs exceeding max failures moved to `archive/permanently_failed_urls.json`
- **Smart Retry Logic**: Avoids endless retries of broken URLs in CI/CD
- **GitHub Actions Optimization**: Only scrapes new content, doesn't refresh old content automatically