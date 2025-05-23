# 🍗 Basted Pocket

> *A personal bookmarking app that saves URLs to your GitHub repository using hashtags for organization.*

Basted Pocket is an Android app that appears in your device's share menu, allowing you to quickly save URLs from any app directly to a markdown file in your GitHub repository. It automatically extracts existing hashtags and lets you add new ones for easy organization.

[![Android](https://img.shields.io/badge/Platform-Android-green.svg)](https://developer.android.com/)
[![Kotlin](https://img.shields.io/badge/Language-Kotlin-blue.svg)](https://kotlinlang.org/)
[![Material 3](https://img.shields.io/badge/Design-Material%203-purple.svg)](https://m3.material.io/)

## ✨ Features

- **📱 Share Intent Integration**: Appears in Android's share menu when sharing URLs
- **🐙 GitHub Integration**: Saves bookmarks directly to your GitHub repository
- **🏷️ Smart Tag Management**: Extracts existing hashtags and lets you add new ones
- **🔍 Tag Search & Filter**: Find and select tags quickly with real-time search
- **⚡ Smart URL Parsing**: Automatically extracts URLs from shared text
- **🔄 Conflict Resolution**: Handles concurrent modifications with automatic retry
- **🎨 Material 3 Design**: Beautiful, adaptive UI with dark/light theme support
- **📱 Responsive Layout**: Works great on phones and tablets

## 📋 Prerequisites

- **Android Device**: API level 26+ (Android 8.0+)
- **GitHub Account**: With a repository for storing bookmarks
- **GitHub PAT**: Personal Access Token with repository access
- **Java 17+**: For building the project

## 🚀 Quick Start

> **TL;DR**: Want to get started fast? Check out the [**Quick Start Guide**](QUICKSTART.md)!
> **📦 Building for Distribution**: Need to build an APK? See the [**Build Guide**](BUILD.md)!

### 1. GitHub Setup

1. **Create a GitHub Personal Access Token:**
   - Go to [GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)
   - Click "Generate new token"
   - Give it a name like "Basted Pocket"
   - Choose expiration period
   - Repository access: "Selected repositories" → choose your bookmarks repo
   - Repository permissions: "Contents" (Read and write) + "Metadata" (Read)
   - Copy the token (starts with `github_pat_`)

2. **Ensure you have a repository** with a `links.md` file:
   ```bash
   # Create the file if it doesn't exist
   echo "# My Bookmarks" > links.md
   git add links.md
   git commit -m "Add bookmarks file"
   git push
   ```

### 2. App Configuration

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd basted-pocket/android
   ```

2. **Configure using the setup script (recommended):**
   ```bash
   ./setup.sh
   ```

   **Or configure manually by editing `local.properties`:**
   ```properties
   # GitHub Personal Access Token
   ghPat=github_pat_your_actual_token_here
   
   # Your GitHub username or organization
   ghOwner=your-github-username
   
   # Your repository name
   ghRepo=your-repository-name
   
   # Optional: Custom path to links file (defaults to links.md)
   # ghPath=bookmarks/links.md
   ```

### 3. Build and Install

```bash
# Set Java 17 (required)
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export PATH=$JAVA_HOME/bin:$PATH

# Build the app
./gradlew build

# Install on connected device
./gradlew installDebug
```

## 📱 How to Use

### Basic Workflow

1. **Share a URL** from any app (Chrome, Twitter, Reddit, etc.)
2. **Select "Basted Pocket"** from the share menu
3. **Choose tags** from your existing hashtags or add new ones
4. **Tap "Save"** to add the bookmark to your repository

### Tag Management

- **Filter existing tags**: Type in the search box to filter your tags
- **Add new tags**: Type a new tag name and press Enter or tap the "Add" button
- **Select multiple tags**: Tap tags to toggle them on/off
- **Tag validation**: Only alphanumeric characters, hyphens, and underscores allowed

### Example Output

When you save a bookmark, it gets added to your `links.md` file like this:

```markdown
- [Example Article](https://example.com/article) #tech #tutorial #android
```

## 🏗️ Architecture

```
📱 Basted Pocket
├── 🎨 UI Layer (Jetpack Compose)
│   ├── ShareActivity.kt      # Main entry point
│   ├── ShareScreen.kt        # UI components
│   ├── ShareViewModel.kt     # Business logic
│   └── ShareUiState.kt       # State management
└── 💾 Data Layer
    ├── GitHubClient.kt       # API communication
    ├── GitHubApi.kt         # Retrofit interface
    ├── GitHubModels.kt      # Data models
    └── TagParser.kt         # Content processing
```

### Key Technical Features

- **🔄 Conflict Resolution**: Automatic retry with exponential backoff for 409 conflicts
- **📝 Base64 Handling**: Proper encoding/decoding of GitHub file content
- **🔍 URL Extraction**: Regex-based URL parsing from shared text
- **✅ Tag Validation**: Ensures hashtags follow GitHub-friendly patterns
- **🎯 Error Handling**: Comprehensive error messages and user feedback

## 🧪 Testing

The project includes comprehensive unit tests:

```bash
# Run all tests
./gradlew test

# Run with coverage
./gradlew testDebugUnitTestCoverage
```

### Test Coverage

- ✅ Tag extraction from markdown content
- ✅ Tag filtering and search functionality
- ✅ New tag addition and validation
- ✅ Markdown formatting and URL parsing
- ✅ Bookmark appending to existing content

## 🛠️ Development

### Project Structure

```
app/src/main/java/com/snarked/bastedpocket/
├── data/
│   ├── GitHubApi.kt           # Retrofit API interface
│   ├── GitHubClient.kt        # GitHub API client with retry logic
│   ├── GitHubModels.kt        # Data models for API responses
│   └── TagParser.kt           # Hashtag extraction and management
└── ui/
    ├── ShareActivity.kt       # Main activity for share intents
    ├── ShareScreen.kt         # Compose UI components
    ├── ShareUiState.kt        # UI state management
    ├── ShareViewModel.kt      # Business logic and state
    └── theme/                 # Material 3 theme files
```

### Dependencies

- **🎨 Jetpack Compose**: Modern Android UI toolkit
- **🌐 Retrofit**: HTTP client for GitHub API
- **📡 OkHttp**: Networking with logging interceptor
- **⚡ Coroutines**: Asynchronous programming
- **🎯 Material 3**: Latest Material Design components
- **🔧 WorkManager**: Background task processing (future use)

### Building from Source

1. **Install Android Studio** or ensure you have Android SDK
2. **Set Java 17** as your JAVA_HOME
3. **Configure local.properties** with your GitHub details
4. **Run the build**:
   ```bash
   ./gradlew assembleDebug
   ```

## 🚧 Roadmap

### ✅ Completed (Sprints 0-3)
- GitHub API integration with conflict resolution
- Tag parsing and management system
- Share intent handling and URL extraction
- Complete Compose UI with Material 3 design
- Comprehensive test coverage

### 🔮 Future Enhancements (Sprint 4+)
- **📱 Offline Support**: Queue bookmarks when offline, sync when connected
- **🔍 Link Validation**: Verify URLs and fetch page metadata
- **📊 Analytics**: Tag usage statistics and suggestions
- **🔄 Export/Import**: Backup and restore functionality
- **🎨 Customization**: Custom themes and tag colors
- **🔗 Deep Linking**: Direct links to tag collections

## ❗ Troubleshooting

### Build Issues

**Java Version Error**:
```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export PATH=$JAVA_HOME/bin:$PATH
```

**Dependency Resolution Issues**:
```bash
./gradlew clean
./gradlew build --refresh-dependencies
```

### Runtime Issues

**"GitHub token not configured"**:
- Verify `ghPat` is set correctly in `local.properties`
- Ensure the token has `repo` scope (classic) or `Contents` + `Metadata` permissions (fine-grained)
- Check that the token hasn't expired
- If using a fine-grained token, ensure it has access to the specific repository

**"Repository not found"**:
- Verify `ghOwner` and `ghRepo` in `local.properties`
- Ensure the repository exists and is accessible
- Check repository permissions

**"File not found: links.md"**:
- Create the file in your repository root
- Verify the path matches `ghPath` configuration
- Ensure the file is committed to the main branch

**Network Errors**:
- Check internet connectivity
- Verify GitHub API access (try curl)
- Check for corporate firewall issues

## 📄 License

This project is for personal use. Feel free to fork and modify for your own bookmarking needs.

---

## 🤝 Contributing

While this is primarily a personal project, contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Follow the existing code style
5. Submit a pull request

## 📞 Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review the GitHub Issues for similar problems
3. Create a new issue with details about your setup and the error

---

**Happy bookmarking! 🍗📚** 