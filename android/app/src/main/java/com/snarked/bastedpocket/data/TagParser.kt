package com.snarked.bastedpocket.data

import android.util.Log
import java.util.*

/**
 * Represents a tag that can be selected or unselected
 */
data class Tag(
    val name: String,
    var isSelected: Boolean = false
) {
    companion object {
        /**
         * Creates a tag from a hashtag string, removing the # prefix
         */
        fun fromHashtag(hashtag: String): Tag {
            val cleanName = hashtag.removePrefix("#")
            return Tag(cleanName)
        }
    }
    
    /**
     * Returns the tag name with # prefix for display
     */
    fun toHashtag(): String = "#$name"
}

/**
 * Parser for extracting and managing tags from markdown content
 */
class TagParser {
    
    companion object {
        private const val TAG = "TagParser"
        
        // Regex pattern to match hashtags: #[A-Za-z0-9_-]+
        // This matches the pattern specified in the requirements
        private val HASHTAG_PATTERN = Regex("#[A-Za-z0-9_-]+")
        
        private fun safeLog(priority: Int, tag: String, message: String) {
            try {
                when (priority) {
                    Log.DEBUG -> Log.d(tag, message)
                    Log.WARN -> Log.w(tag, message)
                    else -> Log.i(tag, message)
                }
            } catch (e: RuntimeException) {
                // Ignore logging errors in test environment
            }
        }
    }
    
    /**
     * Extract all unique tags from markdown content
     * @param content The markdown content to parse
     * @return List of unique tags, sorted alphabetically
     */
    fun extractTags(content: String): List<Tag> {
        safeLog(Log.DEBUG, TAG, "Extracting tags from content (${content.length} chars)")
        
        val hashtags = HASHTAG_PATTERN.findAll(content)
            .map { it.value }
            .toSet() // Remove duplicates
            .sorted() // Sort alphabetically
        
        safeLog(Log.DEBUG, TAG, "Found ${hashtags.size} unique hashtags: $hashtags")
        
        return hashtags.map { Tag.fromHashtag(it) }
    }
    
    /**
     * Data class representing a bookmark entry from markdown
     */
    data class BookmarkEntry(
        val url: String,
        val tags: List<String>,
        val lineIndex: Int,
        val fullLine: String
    )
    
    /**
     * Extract all bookmark entries from markdown content
     * @param content The markdown content to parse
     * @return List of bookmark entries with their URLs, tags, and line positions
     */
    fun extractBookmarkEntries(content: String): List<BookmarkEntry> {
        val lines = content.lines()
        val entries = mutableListOf<BookmarkEntry>()
        
        lines.forEachIndexed { index, line ->
            val trimmedLine = line.trim()
            if (trimmedLine.startsWith("- ") && trimmedLine.contains("http")) {
                // Split the line to separate URL from tags and notes
                val parts = trimmedLine.removePrefix("- ").split(" ")
                
                // Find the URL part (should be first and start with http)
                val urlPart = parts.firstOrNull { it.startsWith("http") }
                
                if (urlPart != null) {
                    // Extract hashtags from this line
                    val hashtags = HASHTAG_PATTERN.findAll(trimmedLine)
                        .map { it.value.removePrefix("#") }
                        .toList()
                    
                    entries.add(BookmarkEntry(
                        url = urlPart,
                        tags = hashtags,
                        lineIndex = index,
                        fullLine = line
                    ))
                }
            }
        }
        
        safeLog(Log.DEBUG, TAG, "Found ${entries.size} bookmark entries")
        return entries
    }
    
    /**
     * Find existing bookmark entry for a given URL
     * @param content The markdown content to search
     * @param url The URL to find
     * @return BookmarkEntry if found, null otherwise
     */
    fun findExistingBookmark(content: String, url: String): BookmarkEntry? {
        return extractBookmarkEntries(content).find { it.url == url }
    }
    
    /**
     * Filter tags based on search query
     * @param tags The list of tags to filter
     * @param query The search query (case-insensitive)
     * @return Filtered list of tags
     */
    fun filterTags(tags: List<Tag>, query: String): List<Tag> {
        if (query.isBlank()) return tags
        
        val lowercaseQuery = query.lowercase().removePrefix("#")
        
        return tags.filter { tag ->
            tag.name.lowercase().contains(lowercaseQuery)
        }
    }
    
    /**
     * Add a new tag to the list if it doesn't already exist
     * @param tags Current list of tags
     * @param newTagName The name of the new tag (without # prefix)
     * @return Updated list of tags with the new tag added and selected
     */
    fun addNewTag(tags: List<Tag>, newTagName: String): List<Tag> {
        val cleanName = newTagName.removePrefix("#").trim()
        
        if (cleanName.isBlank()) {
            safeLog(Log.WARN, TAG, "Attempted to add empty tag name")
            return tags
        }
        
        // Validate tag name format
        if (!isValidTagName(cleanName)) {
            safeLog(Log.WARN, TAG, "Invalid tag name format: $cleanName")
            return tags
        }
        
        // Check if tag already exists (case-insensitive)
        val existingTag = tags.find { it.name.equals(cleanName, ignoreCase = true) }
        if (existingTag != null) {
            safeLog(Log.DEBUG, TAG, "Tag '$cleanName' already exists, selecting it")
            // Select the existing tag and return
            return tags.map { tag ->
                if (tag.name.equals(cleanName, ignoreCase = true)) {
                    tag.copy(isSelected = true)
                } else {
                    tag
                }
            }
        }
        
        safeLog(Log.DEBUG, TAG, "Adding new tag: $cleanName")
        val newTag = Tag(cleanName, isSelected = true)
        
        // Add the new tag and sort the list
        return (tags + newTag).sortedBy { it.name.lowercase() }
    }
    
    /**
     * Toggle the selection state of a tag
     * @param tags Current list of tags
     * @param tagName The name of the tag to toggle
     * @return Updated list of tags
     */
    fun toggleTag(tags: List<Tag>, tagName: String): List<Tag> {
        return tags.map { tag ->
            if (tag.name.equals(tagName, ignoreCase = true)) {
                tag.copy(isSelected = !tag.isSelected)
            } else {
                tag
            }
        }
    }
    
    /**
     * Get all currently selected tags
     * @param tags The list of tags
     * @return List of selected tags
     */
    fun getSelectedTags(tags: List<Tag>): List<Tag> {
        return tags.filter { it.isSelected }
    }
    
    /**
     * Create a markdown line for a URL with selected tags
     * @param url The URL to bookmark
     * @param title The title/description for the link (not used in simple format)
     * @param selectedTags The tags to include
     * @return Formatted markdown line
     */
    fun createMarkdownLine(url: String, title: String?, selectedTags: List<Tag>): String {
        val hashtags = selectedTags.joinToString(" ") { it.toHashtag() }
        
        return "- $url $hashtags"
    }
    
    /**
     * Append a new bookmark line to existing markdown content with year-based organization
     * Handles duplicate URLs by removing the old entry and placing the new one at the top
     * @param existingContent The current markdown content
     * @param url The URL to add
     * @param title The title for the link (not used in simple format)
     * @param selectedTags The tags to include
     * @return Updated markdown content
     */
    fun appendBookmark(
        existingContent: String,
        url: String,
        title: String?,
        selectedTags: List<Tag>
    ): String {
        val newLine = createMarkdownLine(url, title, selectedTags)
        val currentYear = Calendar.getInstance().get(Calendar.YEAR).toString()
        
        if (existingContent.isBlank()) {
            // Create a completely new file with proper structure
            return buildString {
                appendLine("# Basted Pocket Links")
                appendLine()
                appendLine("## $currentYear")
                appendLine()
                append(newLine)
            }
        }
        
        // Check for existing bookmark with same URL
        val existingBookmark = findExistingBookmark(existingContent, url)
        val lines = existingContent.lines().toMutableList()
        
        // Remove existing bookmark line if found
        if (existingBookmark != null) {
            safeLog(Log.DEBUG, TAG, "Found existing bookmark for $url at line ${existingBookmark.lineIndex}, removing it")
            lines.removeAt(existingBookmark.lineIndex)
        }
        
        val yearHeaderPattern = Regex("^## (\\d{4})$")
        
        // Find existing year header or determine where to insert new one
        var currentYearHeaderIndex = -1
        var insertionIndex = -1
        
        for (i in lines.indices) {
            val line = lines[i].trim()
            val yearMatch = yearHeaderPattern.find(line)
            if (yearMatch != null) {
                val year = yearMatch.groupValues[1]
                if (year == currentYear) {
                    currentYearHeaderIndex = i
                    break
                } else if (year.toInt() < currentYear.toInt()) {
                    // Found an older year, we should insert current year before this
                    insertionIndex = i
                    break
                }
            }
        }
        
        if (currentYearHeaderIndex != -1) {
            // Current year header exists, find where to insert the new link
            // Insert right after the year header and any empty lines
            var insertPos = currentYearHeaderIndex + 1
            
            // Skip any empty lines after the year header
            while (insertPos < lines.size && lines[insertPos].isBlank()) {
                insertPos++
            }
            
            // Insert the new bookmark at the top of the year section
            lines.add(insertPos, newLine)
        } else {
            // Current year header doesn't exist, need to add it
            if (insertionIndex != -1) {
                // Insert before an older year
                lines.add(insertionIndex, "")
                lines.add(insertionIndex + 1, "## $currentYear")
                lines.add(insertionIndex + 2, "")
                lines.add(insertionIndex + 3, newLine)
            } else {
                // No year headers found, or all years are newer
                // Find where to insert after the main title
                var insertPos = 0
                
                // Skip title and any initial content until we find a good spot
                for (i in lines.indices) {
                    val line = lines[i].trim()
                    if (line.startsWith("#") && !line.startsWith("##")) {
                        // Found main title, insert after it
                        insertPos = i + 1
                        break
                    }
                }
                
                // Skip any empty lines after the title
                while (insertPos < lines.size && lines[insertPos].isBlank()) {
                    insertPos++
                }
                
                // Insert the year header and bookmark
                lines.add(insertPos, "")
                lines.add(insertPos + 1, "## $currentYear")
                lines.add(insertPos + 2, "")
                lines.add(insertPos + 3, newLine)
            }
        }
        
        return lines.joinToString("\n")
    }
    
    /**
     * Validate if a tag name follows the allowed format
     * @param tagName The tag name to validate
     * @return true if valid, false otherwise
     */
    private fun isValidTagName(tagName: String): Boolean {
        // Must match the pattern [A-Za-z0-9_-]+ (alphanumeric, underscore, hyphen)
        return tagName.matches(Regex("[A-Za-z0-9_-]+"))
    }
} 