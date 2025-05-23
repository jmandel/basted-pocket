#!/usr/bin/env bun

import { readFileSync } from 'fs';

export interface ParsedLink {
  id: string;
  original_url: string;
  canonical_url: string;
  user_title?: string;
  user_tags: string[];
  user_notes?: string;
  time_added_to_links_md?: string;
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove common tracking parameters
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    paramsToRemove.forEach(param => parsed.searchParams.delete(param));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function generateId(url: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(url).digest('hex').substring(0, 16);
}

export function parseLinksMarkdown(): ParsedLink[] {
  try {
    const content = readFileSync('links.md', 'utf-8');
    const lines = content.split('\n');
    const links: ParsedLink[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines, headers, and non-list items
      if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('-')) {
        continue;
      }

      // Extract URL from markdown link format or plain URL
      let url = '';
      let title = '';
      const tags: string[] = [];
      let notes = '';

      // Match [title](url) format
      const linkMatch = trimmed.match(/\[([^\]]*)\]\(([^)]+)\)/);
      if (linkMatch && linkMatch[1] !== undefined && linkMatch[2] !== undefined) {
        title = linkMatch[1];
        url = linkMatch[2];
      } else {
        // Match plain URL
        const urlMatch = trimmed.match(/https?:\/\/[^\s#@]+/);
        if (urlMatch && urlMatch[0] !== undefined) {
          url = urlMatch[0];
        }
      }

      if (!url) continue;

      // Extract tags (#tag) - fixed to include hyphens
      const tagMatches = trimmed.matchAll(/#([\w-]+)/g);
      for (const match of tagMatches) {
        if (match[1] !== undefined) {
          tags.push(match[1]);
        }
      }

      // Extract notes (@note:text)
      const noteMatch = trimmed.match(/@note:([^#]*)/);
      if (noteMatch && noteMatch[1] !== undefined) {
        notes = noteMatch[1].trim();
      }

      const canonical_url = canonicalizeUrl(url);
      const id = generateId(canonical_url);

      links.push({
        id,
        original_url: url,
        canonical_url,
        user_title: title || undefined,
        user_tags: tags,
        user_notes: notes || undefined
      });
    }

    console.log(`Parsed ${links.length} links from links.md`);
    return links;
  } catch (error) {
    console.error('Error parsing links.md:', error);
    return [];
  }
} 