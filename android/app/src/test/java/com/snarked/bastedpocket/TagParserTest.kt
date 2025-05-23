package com.snarked.bastedpocket

import com.snarked.bastedpocket.data.Tag
import com.snarked.bastedpocket.data.TagParser
import org.junit.Test
import org.junit.Assert.*

class TagParserTest {
    
    private val tagParser = TagParser()
    
    @Test
    fun `extractTags should find all unique hashtags`() {
        val content = """
            # Basted Pocket Links
            
            ## 2025
            
            - [Spicy Miso Lentil Soup Recipe](https://cooking.nytimes.com/recipes/1026788-spicy-miso-lentil-soup) #dinner #gf #recipe #soup #veg
            - [How to Cook Fish, the French Way](https://cooking.nytimes.com/recipes/dover-sole-meuniere) #dinner #fish #recipe
            - [Caramelized-Scallion Sauce Recipe](https://cooking.nytimes.com/recipes/1019308-caramelized-scallion-sauce) #dinner #recipe
            - [Ramen With Charred Scallions](https://cooking.nytimes.com/recipes/1021339-ramen) #asian #dinner #noodles #recipe
        """.trimIndent()
        
        val tags = tagParser.extractTags(content)
        
        val expectedTags = listOf("asian", "dinner", "fish", "gf", "noodles", "recipe", "soup", "veg")
        val actualTagNames = tags.map { it.name }.sorted()
        
        assertEquals(expectedTags, actualTagNames)
        
        // All tags should start unselected
        assertTrue(tags.all { !it.isSelected })
    }
    
    @Test
    fun `filterTags should work case-insensitively`() {
        val tags = listOf(
            Tag("dinner"),
            Tag("Recipe"),
            Tag("SOUP"),
            Tag("asian")
        )
        
        val filtered = tagParser.filterTags(tags, "rec")
        
        assertEquals(1, filtered.size)
        assertTrue(filtered.any { it.name == "Recipe" })
    }
    
    @Test
    fun `addNewTag should add valid tags and select them`() {
        val existingTags = listOf(Tag("dinner"), Tag("recipe"))
        
        val updatedTags = tagParser.addNewTag(existingTags, "breakfast")
        
        assertEquals(3, updatedTags.size)
        val breakfastTag = updatedTags.find { it.name == "breakfast" }
        assertNotNull(breakfastTag)
        assertTrue(breakfastTag!!.isSelected)
    }
    
    @Test
    fun `addNewTag should select existing tag if already present`() {
        val existingTags = listOf(Tag("dinner", false), Tag("recipe", false))
        
        val updatedTags = tagParser.addNewTag(existingTags, "dinner")
        
        assertEquals(2, updatedTags.size)
        val dinnerTag = updatedTags.find { it.name == "dinner" }
        assertTrue(dinnerTag!!.isSelected)
    }
    
    @Test
    fun `createMarkdownLine should format correctly with new simple format`() {
        val selectedTags = listOf(Tag("dinner", true), Tag("recipe", true))
        
        val line = tagParser.createMarkdownLine(
            "https://example.com/recipe",
            "Example Recipe", // Title is ignored in new format
            selectedTags
        )
        
        // Should match: - URL #tags (no timestamp)
        assertEquals("- https://example.com/recipe #dinner #recipe", line)
    }
    
    @Test
    fun `appendBookmark should handle empty content with proper year structure`() {
        val selectedTags = listOf(Tag("test", true))
        
        val result = tagParser.appendBookmark(
            "",
            "https://example.com",
            "Test Link", // Title ignored in new format
            selectedTags
        )
        
        // Should create proper structure with current year
        val lines = result.lines()
        assertEquals("# Basted Pocket Links", lines[0])
        assertEquals("", lines[1])
        assertTrue(lines[2].matches(Regex("## \\d{4}"))) // Current year
        assertEquals("", lines[3])
        assertEquals("- https://example.com #test", lines[4])
    }
    
    @Test
    fun `appendBookmark should add to existing year section`() {
        val existingContent = """# Basted Pocket Links

## 2025

- https://old.com #old @note:Added_to_Pocket_on_2025-01-01

## 2024

- https://older.com #older @note:Added_to_Pocket_on_2024-12-31"""
        
        val selectedTags = listOf(Tag("new", true))
        
        val result = tagParser.appendBookmark(
            existingContent,
            "https://new.com",
            "New Link", // Title ignored
            selectedTags
        )
        
        // Should insert at top of 2025 section
        val lines = result.lines()
        val newBookmarkIndex = lines.indexOfFirst { it.contains("https://new.com") }
        assertTrue(newBookmarkIndex > 0)
        assertEquals("- https://new.com #new", lines[newBookmarkIndex].trim())
        
        // Should be right after the "## 2025" header
        val yearHeaderIndex = lines.indexOfFirst { it.trim() == "## 2025" }
        assertTrue(newBookmarkIndex > yearHeaderIndex)
        assertTrue(newBookmarkIndex < lines.indexOfFirst { it.contains("https://old.com") })
    }
    
    @Test
    fun `toggleTag should change selection state`() {
        val tags = listOf(Tag("dinner", false), Tag("recipe", true))
        
        val updatedTags = tagParser.toggleTag(tags, "dinner")
        
        val dinnerTag = updatedTags.find { it.name == "dinner" }
        assertTrue(dinnerTag!!.isSelected)
        
        val recipeTag = updatedTags.find { it.name == "recipe" }
        assertTrue(recipeTag!!.isSelected) // Should remain unchanged
    }
    
    @Test
    fun `getSelectedTags should return only selected tags`() {
        val tags = listOf(
            Tag("dinner", true),
            Tag("recipe", false),
            Tag("soup", true)
        )
        
        val selectedTags = tagParser.getSelectedTags(tags)
        
        assertEquals(2, selectedTags.size)
        assertTrue(selectedTags.any { it.name == "dinner" })
        assertTrue(selectedTags.any { it.name == "soup" })
    }
    
    @Test
    fun `findExistingBookmark should detect existing URLs`() {
        val content = """# Basted Pocket Links

## 2025

- https://example.com/test #recipe #dinner @note:Added_to_Pocket_on_2025-01-01
- https://other.com/article #news @note:Added_to_Pocket_on_2025-01-02"""
        
        val existingBookmark = tagParser.findExistingBookmark(content, "https://example.com/test")
        
        assertNotNull(existingBookmark)
        assertEquals("https://example.com/test", existingBookmark!!.url)
        assertEquals(listOf("recipe", "dinner"), existingBookmark.tags)
        assertTrue(existingBookmark.lineIndex >= 0)
    }
    
    @Test
    fun `findExistingBookmark should return null for non-existing URLs`() {
        val content = """# Basted Pocket Links

## 2025

- https://example.com/test #recipe #dinner @note:Added_to_Pocket_on_2025-01-01"""
        
        val existingBookmark = tagParser.findExistingBookmark(content, "https://nonexistent.com")
        
        assertNull(existingBookmark)
    }
    
    @Test
    fun `appendBookmark should replace existing URL and move to top`() {
        val existingContent = """# Basted Pocket Links

## 2025

- https://other.com #other @note:Added_to_Pocket_on_2025-01-01
- https://example.com/test #old #tags @note:Added_to_Pocket_on_2025-01-01
- https://another.com #another @note:Added_to_Pocket_on_2025-01-01"""
        
        val selectedTags = listOf(Tag("new", true), Tag("updated", true))
        
        val result = tagParser.appendBookmark(
            existingContent,
            "https://example.com/test", // Same URL as existing
            null,
            selectedTags
        )
        
        val lines = result.lines()
        
        // Should have one less line (old entry removed)
        assertEquals(existingContent.lines().size, lines.size)
        
        // New bookmark should be at top of 2025 section
        val newBookmarkIndex = lines.indexOfFirst { it.contains("https://example.com/test") }
        assertTrue(newBookmarkIndex > 0)
        assertTrue(lines[newBookmarkIndex].contains("#new #updated"))
        
        // Should be before the other URLs
        val otherUrlIndex = lines.indexOfFirst { it.contains("https://other.com") }
        assertTrue(newBookmarkIndex < otherUrlIndex)
        
        // Old tags should not be present
        assertFalse(lines[newBookmarkIndex].contains("#old"))
        assertFalse(lines[newBookmarkIndex].contains("#tags"))
        
        // Should match simple format
        assertEquals("- https://example.com/test #new #updated", lines[newBookmarkIndex].trim())
    }
    
    @Test
    fun `findExistingBookmark should properly extract URL without @note suffix`() {
        val content = """# Basted Pocket Links

## 2025

- https://cooking.nytimes.com/recipes/1026167-scallion-oil-fish #dinner #fish #tried-and-true @note:Added_to_Pocket_on_2025-05-23"""
        
        val existingBookmark = tagParser.findExistingBookmark(content, "https://cooking.nytimes.com/recipes/1026167-scallion-oil-fish")
        
        assertNotNull(existingBookmark)
        assertEquals("https://cooking.nytimes.com/recipes/1026167-scallion-oil-fish", existingBookmark!!.url)
        assertEquals(listOf("dinner", "fish", "tried-and-true"), existingBookmark.tags)
        
        // Verify URL doesn't contain @note suffix
        assertFalse(existingBookmark.url.contains("@note"))
        assertFalse(existingBookmark.url.contains("2025-05-23"))
    }
}