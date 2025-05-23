package com.snarked.bastedpocket.data

import com.google.gson.annotations.SerializedName

/**
 * Response from GitHub's Get a file endpoint
 */
data class GitHubFile(
    @SerializedName("content") val content: String,
    @SerializedName("sha") val sha: String,
    @SerializedName("size") val size: Int? = null,
    @SerializedName("name") val name: String? = null,
    @SerializedName("path") val path: String? = null
)

/**
 * Request body for GitHub's Create or update file contents endpoint
 */
data class GitHubFileUpdateRequest(
    @SerializedName("message") val message: String,
    @SerializedName("content") val content: String,
    @SerializedName("sha") val sha: String? = null
)

/**
 * Response from GitHub's Create or update file contents endpoint
 */
data class GitHubFileUpdateResponse(
    @SerializedName("content") val content: GitHubFile,
    @SerializedName("commit") val commit: GitHubCommit
)

data class GitHubCommit(
    @SerializedName("sha") val sha: String,
    @SerializedName("message") val message: String
) 