package com.snarked.bastedpocket.ui

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import com.snarked.bastedpocket.ui.theme.BastedPocketTheme

class ShareActivity : ComponentActivity() {
    
    companion object {
        private const val TAG = "ShareActivity"
    }
    
    private val viewModel: ShareViewModel by viewModels()
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        Log.d(TAG, "ShareActivity created")
        
        // Extract URL from share intent
        val sharedUrl = extractUrlFromIntent(intent)
        if (sharedUrl.isNullOrBlank()) {
            Log.w(TAG, "No URL found in intent, finishing activity")
            finish()
            return
        }
        
        Log.d(TAG, "Received shared URL: $sharedUrl")
        
        // Initialize ViewModel with the URL
        viewModel.initializeWithUrl(sharedUrl)
        
        setContent {
            BastedPocketTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val uiState by viewModel.uiState.collectAsState()
                    
                    // Handle success - show toast and close activity
                    uiState.successMessage?.let { message ->
                        LaunchedEffect(message) {
                            Toast.makeText(this@ShareActivity, message, Toast.LENGTH_SHORT).show()
                            // Small delay to ensure toast is visible before closing
                            kotlinx.coroutines.delay(500)
                            finish()
                        }
                    }
                    
                    ShareScreen(
                        uiState = uiState,
                        onEvent = viewModel::onEvent,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }
    
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        
        // Handle new share intent
        val sharedUrl = extractUrlFromIntent(intent)
        if (!sharedUrl.isNullOrBlank()) {
            Log.d(TAG, "Received new shared URL: $sharedUrl")
            viewModel.initializeWithUrl(sharedUrl)
        }
    }
    
    /**
     * Extract URL from the share intent
     */
    private fun extractUrlFromIntent(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_SEND) {
            Log.w(TAG, "Intent action is not ACTION_SEND: ${intent?.action}")
            return null
        }
        
        if (intent.type?.startsWith("text/") != true) {
            Log.w(TAG, "Intent type is not text: ${intent.type}")
            return null
        }
        
        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
        if (sharedText.isNullOrBlank()) {
            Log.w(TAG, "EXTRA_TEXT is null or blank")
            return null
        }
        
        Log.d(TAG, "Shared text: $sharedText")
        
        // Extract URL from the shared text
        // The shared text might contain more than just the URL
        return extractUrlFromText(sharedText)
    }
    
    /**
     * Extract the first URL found in the given text
     */
    private fun extractUrlFromText(text: String): String? {
        // Regex pattern to match URLs
        val urlPattern = Regex(
            """https?://[^\s\]]+""",
            RegexOption.IGNORE_CASE
        )
        
        val matchResult = urlPattern.find(text)
        val url = matchResult?.value
        
        if (url != null) {
            Log.d(TAG, "Extracted URL: $url")
            return url
        }
        
        // If no http/https URL found, check if the entire text looks like a URL
        val trimmedText = text.trim()
        if (trimmedText.contains(".") && !trimmedText.contains(" ")) {
            // Likely a URL without protocol
            val urlWithProtocol = "https://$trimmedText"
            Log.d(TAG, "Adding protocol to URL: $urlWithProtocol")
            return urlWithProtocol
        }
        
        Log.w(TAG, "No URL found in text: $text")
        return null
    }
} 