package com.snarked.bastedpocket.data

import android.util.Base64
import android.util.Log
import com.snarked.bastedpocket.BuildConfig
import kotlinx.coroutines.delay
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.nio.charset.StandardCharsets

/**
 * Result wrapper for API operations
 */
sealed class ApiResult<T> {
    data class Success<T>(val data: T) : ApiResult<T>()
    data class Error<T>(val message: String, val throwable: Throwable? = null) : ApiResult<T>()
    data class Conflict<T>(val message: String) : ApiResult<T>() // For 409 conflicts
}

/**
 * Data class representing a GitHub file with its content and metadata
 */
data class GitHubFileData(
    val content: String,
    val sha: String,
    val decodedContent: String
) {
    companion object {
        fun fromGitHubFile(gitHubFile: GitHubFile): GitHubFileData {
            val decodedContent = try {
                // GitHub returns content as base64 encoded
                val cleanedContent = gitHubFile.content.replace("\n", "").replace("\r", "")
                val decodedBytes = Base64.decode(cleanedContent, Base64.DEFAULT)
                String(decodedBytes, StandardCharsets.UTF_8)
            } catch (e: Exception) {
                Log.e("GitHubFileData", "Failed to decode content", e)
                ""
            }
            
            return GitHubFileData(
                content = gitHubFile.content,
                sha = gitHubFile.sha,
                decodedContent = decodedContent
            )
        }
    }
}

/**
 * Client for interacting with GitHub API
 */
class GitHubClient {
    
    companion object {
        private const val TAG = "GitHubClient"
        private const val BASE_URL = "https://api.github.com/"
        private const val MAX_RETRIES = 3
        private const val INITIAL_RETRY_DELAY_MS = 1000L
    }
    
    private val api: GitHubApi
    
    init {
        val loggingInterceptor = HttpLoggingInterceptor { message ->
            Log.d(TAG, message)
        }.apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BODY
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }
        
        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(loggingInterceptor)
            .build()
        
        val retrofit = Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
        
        api = retrofit.create(GitHubApi::class.java)
    }
    
    /**
     * Get a file from the repository
     */
    suspend fun getFile(token: String): ApiResult<GitHubFileData> {
        return try {
            val response = api.getFile(
                owner = BuildConfig.BASTED_REPO_OWNER,
                repo = BuildConfig.BASTED_REPO_NAME,
                path = BuildConfig.LINK_PATH,
                authorization = "Bearer $token"
            )
            
            when {
                response.isSuccessful -> {
                    val gitHubFile = response.body()
                    if (gitHubFile != null) {
                        val fileData = GitHubFileData.fromGitHubFile(gitHubFile)
                        ApiResult.Success(fileData)
                    } else {
                        ApiResult.Error("Response body is null")
                    }
                }
                response.code() == 404 -> {
                    ApiResult.Error("File not found: ${BuildConfig.LINK_PATH}")
                }
                response.code() == 401 -> {
                    ApiResult.Error("Unauthorized: Check your GitHub token")
                }
                else -> {
                    ApiResult.Error("HTTP ${response.code()}: ${response.message()}")
                }
            }
        } catch (e: IOException) {
            ApiResult.Error("Network error: ${e.message}", e)
        } catch (e: Exception) {
            ApiResult.Error("Unexpected error: ${e.message}", e)
        }
    }
    
    /**
     * Update a file in the repository with retry logic for conflicts
     */
    suspend fun putFile(
        token: String,
        content: String,
        sha: String,
        commitMessage: String
    ): ApiResult<GitHubFileUpdateResponse> {
        
        return retry(MAX_RETRIES) { attempt ->
            try {
                // If this is a retry (attempt > 1), we need to get the latest SHA
                val currentSha = if (attempt > 1) {
                    when (val getResult = getFile(token)) {
                        is ApiResult.Success -> getResult.data.sha
                        is ApiResult.Error -> return@retry ApiResult.Error(getResult.message, getResult.throwable)
                        is ApiResult.Conflict -> return@retry ApiResult.Error("Unexpected conflict in getFile")
                    }
                } else {
                    sha
                }
                
                // Encode content to base64
                val encodedContent = Base64.encodeToString(
                    content.toByteArray(StandardCharsets.UTF_8),
                    Base64.NO_WRAP
                )
                
                val request = GitHubFileUpdateRequest(
                    message = commitMessage,
                    content = encodedContent,
                    sha = currentSha
                )
                
                val response = api.putFile(
                    owner = BuildConfig.BASTED_REPO_OWNER,
                    repo = BuildConfig.BASTED_REPO_NAME,
                    path = BuildConfig.LINK_PATH,
                    authorization = "Bearer $token",
                    request = request
                )
                
                when {
                    response.isSuccessful -> {
                        val updateResponse = response.body()
                        if (updateResponse != null) {
                            ApiResult.Success(updateResponse)
                        } else {
                            ApiResult.Error("Response body is null")
                        }
                    }
                    response.code() == 409 -> {
                        Log.w(TAG, "Conflict detected (409), will retry if attempts remaining")
                        ApiResult.Conflict("File was modified by another process")
                    }
                    response.code() == 401 -> {
                        ApiResult.Error("Unauthorized: Check your GitHub token")
                    }
                    response.code() == 422 -> {
                        ApiResult.Error("Invalid SHA or file content")
                    }
                    else -> {
                        ApiResult.Error("HTTP ${response.code()}: ${response.message()}")
                    }
                }
            } catch (e: IOException) {
                ApiResult.Error("Network error: ${e.message}", e)
            } catch (e: Exception) {
                ApiResult.Error("Unexpected error: ${e.message}", e)
            }
        }
    }
    
    /**
     * Retry helper with exponential backoff
     */
    private suspend fun <T> retry(
        maxRetries: Int,
        block: suspend (attempt: Int) -> ApiResult<T>
    ): ApiResult<T> {
        repeat(maxRetries) { attempt ->
            val result = block(attempt + 1)
            
            when (result) {
                is ApiResult.Success -> return result
                is ApiResult.Conflict -> {
                    if (attempt < maxRetries - 1) {
                        val delayMs = INITIAL_RETRY_DELAY_MS * (1L shl attempt) // Exponential backoff
                        Log.i(TAG, "Retrying in ${delayMs}ms (attempt ${attempt + 1}/$maxRetries)")
                        delay(delayMs)
                    } else {
                        return ApiResult.Error("Max retries exceeded due to conflicts")
                    }
                }
                is ApiResult.Error -> return result
            }
        }
        return ApiResult.Error("Unexpected end of retry loop")
    }
} 