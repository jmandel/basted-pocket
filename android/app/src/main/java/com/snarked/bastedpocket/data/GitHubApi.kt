package com.snarked.bastedpocket.data

import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit interface for GitHub API
 */
interface GitHubApi {
    
    /**
     * Get the contents of a file in a repository
     */
    @GET("repos/{owner}/{repo}/contents/{path}")
    suspend fun getFile(
        @Path("owner") owner: String,
        @Path("repo") repo: String,
        @Path("path") path: String,
        @Header("Authorization") authorization: String
    ): Response<GitHubFile>
    
    /**
     * Create or update a file in a repository
     */
    @PUT("repos/{owner}/{repo}/contents/{path}")
    suspend fun putFile(
        @Path("owner") owner: String,
        @Path("repo") repo: String,
        @Path("path") path: String,
        @Header("Authorization") authorization: String,
        @Body request: GitHubFileUpdateRequest
    ): Response<GitHubFileUpdateResponse>
} 