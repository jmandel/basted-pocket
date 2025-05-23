package com.snarked.bastedpocket.ui

import com.snarked.bastedpocket.data.Tag

/**
 * UI state for the share screen
 */
data class ShareUiState(
    val url: String = "",
    val allTags: List<Tag> = emptyList(),
    val filteredTags: List<Tag> = emptyList(),
    val searchQuery: String = "",
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val errorMessage: String? = null,
    val successMessage: String? = null
) {
    /**
     * True if at least one tag is selected
     */
    val canSave: Boolean
        get() = allTags.any { it.isSelected } && !isSaving && !isLoading
    
    /**
     * Get the currently selected tags
     */
    val selectedTags: List<Tag>
        get() = allTags.filter { it.isSelected }
}

/**
 * Events that can be triggered from the UI
 */
sealed class ShareUiEvent {
    data class UpdateSearchQuery(val query: String) : ShareUiEvent()
    data class ToggleTag(val tagName: String) : ShareUiEvent()
    data class AddNewTag(val tagName: String) : ShareUiEvent()
    object SaveBookmark : ShareUiEvent()
    object DismissError : ShareUiEvent()
    object DismissSuccess : ShareUiEvent()
    object LoadTags : ShareUiEvent()
} 