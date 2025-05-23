package com.snarked.bastedpocket.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.snarked.bastedpocket.data.Tag

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareScreen(
    uiState: ShareUiState,
    onEvent: (ShareUiEvent) -> Unit,
    modifier: Modifier = Modifier
) {
    val keyboardController = LocalSoftwareKeyboardController.current
    val scrollState = rememberScrollState()
    
    Column(
        modifier = modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // URL Header
        UrlHeader(url = uiState.url)
        
        // Search/Add Field
        SearchAddField(
            searchQuery = uiState.searchQuery,
            onSearchQueryChange = { onEvent(ShareUiEvent.UpdateSearchQuery(it)) },
            onAddTag = { tagName ->
                onEvent(ShareUiEvent.AddNewTag(tagName))
                keyboardController?.hide()
            }
        )
        
        // Tag List
        when {
            uiState.isLoading -> {
                Box(
                    modifier = Modifier.fillMaxWidth().height(200.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        CircularProgressIndicator()
                        Text("Loading tags...")
                    }
                }
            }
            uiState.filteredTags.isEmpty() && uiState.searchQuery.isNotBlank() -> {
                EmptySearchResults(
                    searchQuery = uiState.searchQuery,
                    onAddTag = { onEvent(ShareUiEvent.AddNewTag(uiState.searchQuery)) }
                )
            }
            uiState.filteredTags.isEmpty() -> {
                EmptyTagsList()
            }
            else -> {
                TagList(
                    tags = uiState.filteredTags,
                    onTagToggle = { onEvent(ShareUiEvent.ToggleTag(it)) }
                )
            }
        }
        
        // Save Button
        SaveButton(
            enabled = uiState.canSave,
            isLoading = uiState.isSaving,
            selectedTagCount = uiState.selectedTags.size,
            onClick = { onEvent(ShareUiEvent.SaveBookmark) }
        )
    }
    
    // Error Messages
    uiState.errorMessage?.let { message ->
        LaunchedEffect(message) {
            // Auto-dismiss error after showing
        }
        AlertDialog(
            onDismissRequest = { onEvent(ShareUiEvent.DismissError) },
            title = { Text("Error") },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = { onEvent(ShareUiEvent.DismissError) }) {
                    Text("OK")
                }
            }
        )
    }
}

@Composable
private fun UrlHeader(
    url: String,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = "Saving to Basted Pocket",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = url,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SearchAddField(
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    onAddTag: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val keyboardController = LocalSoftwareKeyboardController.current
    
    OutlinedTextField(
        value = searchQuery,
        onValueChange = onSearchQueryChange,
        modifier = modifier.fillMaxWidth(),
        label = { Text("Filter or add tag") },
        placeholder = { Text("Type to filter or add new tag") },
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.Add,
                contentDescription = "Add tag"
            )
        },
        trailingIcon = {
            if (searchQuery.isNotEmpty()) {
                IconButton(onClick = { onSearchQueryChange("") }) {
                    Icon(
                        imageVector = Icons.Default.Clear,
                        contentDescription = "Clear search"
                    )
                }
            }
        },
        keyboardOptions = KeyboardOptions.Default.copy(
            imeAction = ImeAction.Done
        ),
        keyboardActions = KeyboardActions(
            onDone = {
                if (searchQuery.isNotBlank()) {
                    onAddTag(searchQuery)
                }
                keyboardController?.hide()
            }
        ),
        singleLine = true
    )
}

@Composable
private fun TagList(
    tags: List<Tag>,
    onTagToggle: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    // Simple grid-like layout using Column and Row
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Group tags into rows of 3 to simulate grid behavior
        tags.chunked(3).forEach { rowTags ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                rowTags.forEach { tag ->
                    TagChip(
                        tag = tag,
                        onClick = { onTagToggle(tag.name) },
                        modifier = Modifier.weight(1f)
                    )
                }
                // Fill remaining space if row is not full
                repeat(3 - rowTags.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TagChip(
    tag: Tag,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    FilterChip(
        onClick = onClick,
        label = {
            Text(
                text = tag.toHashtag(),
                modifier = Modifier.padding(vertical = 4.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        },
        selected = tag.isSelected,
        modifier = modifier.heightIn(min = 40.dp)
    )
}

@Composable
private fun EmptySearchResults(
    searchQuery: String,
    onAddTag: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "No tags found for \"$searchQuery\"",
                style = MaterialTheme.typography.bodyLarge
            )
            Spacer(modifier = Modifier.height(8.dp))
            Button(onClick = onAddTag) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text("Add \"$searchQuery\" as new tag")
            }
        }
    }
}

@Composable
private fun EmptyTagsList(
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.fillMaxWidth().height(100.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = "No tags found. Use the search field to add your first tag!",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun SaveButton(
    enabled: Boolean,
    isLoading: Boolean,
    selectedTagCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth()
    ) {
        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text("Saving...")
        } else {
            val buttonText = when (selectedTagCount) {
                0 -> "Select tags to save"
                1 -> "Save with 1 tag"
                else -> "Save with $selectedTagCount tags"
            }
            Text(buttonText)
        }
    }
} 