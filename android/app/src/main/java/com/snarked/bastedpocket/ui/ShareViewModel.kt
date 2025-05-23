package com.snarked.bastedpocket.ui

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.snarked.bastedpocket.BuildConfig
import com.snarked.bastedpocket.data.ApiResult
import com.snarked.bastedpocket.data.GitHubClient
import com.snarked.bastedpocket.data.TagParser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ShareViewModel : ViewModel() {
    
    companion object {
        private const val TAG = "ShareViewModel"
    }
    
    private val gitHubClient = GitHubClient()
    private val tagParser = TagParser()
    
    private val _uiState = MutableStateFlow(ShareUiState())
    val uiState: StateFlow<ShareUiState> = _uiState.asStateFlow()
    
    private var originalFileContent = ""
    private var fileSha = ""
    
    /**
     * Initialize the ViewModel with a URL from the share intent
     */
    fun initializeWithUrl(url: String) {
        Log.d(TAG, "Initializing with URL: $url")
        _uiState.value = _uiState.value.copy(url = url)
        loadTags()
    }
    
    /**
     * Handle UI events
     */
    fun onEvent(event: ShareUiEvent) {
        when (event) {
            is ShareUiEvent.UpdateSearchQuery -> updateSearchQuery(event.query)
            is ShareUiEvent.ToggleTag -> toggleTag(event.tagName)
            is ShareUiEvent.AddNewTag -> addNewTag(event.tagName)
            ShareUiEvent.SaveBookmark -> saveBookmark()
            ShareUiEvent.DismissError -> dismissError()
            ShareUiEvent.DismissSuccess -> dismissSuccess()
            ShareUiEvent.LoadTags -> loadTags()
        }
    }
    
    private fun updateSearchQuery(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
        updateFilteredTags()
    }
    
    private fun toggleTag(tagName: String) {
        val updatedTags = tagParser.toggleTag(_uiState.value.allTags, tagName)
        _uiState.value = _uiState.value.copy(allTags = updatedTags)
        updateFilteredTags()
    }
    
    private fun addNewTag(tagName: String) {
        if (tagName.isBlank()) return
        
        val updatedTags = tagParser.addNewTag(_uiState.value.allTags, tagName)
        _uiState.value = _uiState.value.copy(
            allTags = updatedTags,
            searchQuery = "" // Clear search after adding
        )
        updateFilteredTags()
    }
    
    private fun updateFilteredTags() {
        val filteredTags = tagParser.filterTags(_uiState.value.allTags, _uiState.value.searchQuery)
        _uiState.value = _uiState.value.copy(filteredTags = filteredTags)
    }
    
    private fun loadTags() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            
            val token = BuildConfig.GITHUB_PAT
            if (token.isBlank()) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = "GitHub token not configured. Please set ghPat in local.properties"
                )
                return@launch
            }
            
            when (val result = gitHubClient.getFile(token)) {
                is ApiResult.Success -> {
                    originalFileContent = result.data.decodedContent
                    fileSha = result.data.sha
                    
                    val extractedTags = tagParser.extractTags(originalFileContent)
                    
                    // Check if this URL already exists and pre-populate its tags
                    val currentUrl = _uiState.value.url
                    val existingBookmark = tagParser.findExistingBookmark(originalFileContent, currentUrl)
                    
                    val tagsWithSelection = if (existingBookmark != null) {
                        Log.d(TAG, "Found existing bookmark for $currentUrl with tags: ${existingBookmark.tags}")
                        // Pre-select tags that were previously used for this URL
                        extractedTags.map { tag ->
                            tag.copy(isSelected = existingBookmark.tags.contains(tag.name))
                        }
                    } else {
                        extractedTags
                    }
                    
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        allTags = tagsWithSelection,
                        filteredTags = tagsWithSelection
                    )
                    
                    Log.d(TAG, "Loaded ${extractedTags.size} tags from GitHub")
                    if (existingBookmark != null) {
                        Log.d(TAG, "Pre-populated ${existingBookmark.tags.size} tags for existing URL")
                    }
                }
                is ApiResult.Error -> {
                    Log.e(TAG, "Failed to load tags: ${result.message}", result.throwable)
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = "Failed to load tags: ${result.message}"
                    )
                }
                is ApiResult.Conflict -> {
                    Log.e(TAG, "Unexpected conflict when loading tags: ${result.message}")
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = "Unexpected error loading tags"
                    )
                }
            }
        }
    }
    
    private fun saveBookmark() {
        val currentState = _uiState.value
        val selectedTags = tagParser.getSelectedTags(currentState.allTags)
        
        if (selectedTags.isEmpty()) {
            _uiState.value = currentState.copy(errorMessage = "Please select at least one tag")
            return
        }
        
        viewModelScope.launch {
            _uiState.value = currentState.copy(isSaving = true, errorMessage = null)
            
            val token = BuildConfig.GITHUB_PAT
            if (token.isBlank()) {
                _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    errorMessage = "GitHub token not configured"
                )
                return@launch
            }
            
            try {
                // Check if this is updating an existing bookmark
                val existingBookmark = tagParser.findExistingBookmark(originalFileContent, currentState.url)
                
                // Create the updated file content
                val updatedContent = tagParser.appendBookmark(
                    existingContent = originalFileContent,
                    url = currentState.url,
                    title = null, // Let TagParser extract from URL
                    selectedTags = selectedTags
                )
                
                val commitMessage = if (existingBookmark != null) {
                    "Update ${currentState.url} via Basted Pocket"
                } else {
                    "Add ${currentState.url} via Basted Pocket"
                }
                
                when (val result = gitHubClient.putFile(token, updatedContent, fileSha, commitMessage)) {
                    is ApiResult.Success -> {
                        Log.d(TAG, "Successfully saved bookmark")
                        _uiState.value = _uiState.value.copy(
                            isSaving = false,
                            successMessage = "Saved to Basted Pocket"
                        )
                        
                        // Update our local state
                        originalFileContent = updatedContent
                        fileSha = result.data.content.sha
                    }
                    is ApiResult.Error -> {
                        Log.e(TAG, "Failed to save bookmark: ${result.message}", result.throwable)
                        _uiState.value = _uiState.value.copy(
                            isSaving = false,
                            errorMessage = "Failed to save: ${result.message}"
                        )
                    }
                    is ApiResult.Conflict -> {
                        Log.e(TAG, "Conflict when saving bookmark: ${result.message}")
                        _uiState.value = _uiState.value.copy(
                            isSaving = false,
                            errorMessage = "Save failed due to conflict. Please try again."
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected error saving bookmark", e)
                _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    errorMessage = "Unexpected error: ${e.message}"
                )
            }
        }
    }
    
    private fun dismissError() {
        _uiState.value = _uiState.value.copy(errorMessage = null)
    }
    
    private fun dismissSuccess() {
        _uiState.value = _uiState.value.copy(successMessage = null)
    }
} 