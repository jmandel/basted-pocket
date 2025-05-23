# 🚀 Quick Start Guide

Get Basted Pocket up and running in 5 minutes!

## Prerequisites ✅

- [ ] Android device (API 26+)
- [ ] GitHub account
- [ ] Git installed
- [ ] Java 17+ installed

## Step 1: GitHub Setup 🐙

### Create a Repository
```bash
# Create a new repo on GitHub or use existing one
mkdir my-bookmarks
cd my-bookmarks
echo "# My Bookmarks" > links.md
git init
git add links.md
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### Create Personal Access Token
1. Go to [GitHub Settings → Tokens](https://github.com/settings/tokens)
2. Click "Generate new token" → "**Fine-grained personal access token**"
3. Name: "Basted Pocket"
4. Expiration: Choose your preferred duration
5. Repository access: Select "Selected repositories" → Choose your bookmarks repo
6. Repository permissions:
   - ✅ **Contents**: Read and write
   - ✅ **Metadata**: Read
7. Click "Generate token"
8. Copy the token (starts with `github_pat_`)

## Step 2: App Setup ⚙️

### Clone and Configure
```bash
git clone https://github.com/YOUR_USERNAME/basted-pocket.git
cd basted-pocket/android

# Interactive setup (recommended)
./setup.sh

# OR manual setup
cp local.properties.sample local.properties
# Edit local.properties with your details
```

### Your `local.properties` should look like:
```properties
sdk.dir=/path/to/AndroidSDK
ghPat=github_pat_your_actual_token_here
ghOwner=your-github-username
ghRepo=your-repo-name
ghPath=links.md
```

## Step 3: Build & Install 🔨

```bash
# Set Java 17 (if needed)
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export PATH=$JAVA_HOME/bin:$PATH

# Build
./gradlew assembleDebug

# Install on connected device
./gradlew installDebug
```

## Step 4: Test It! 📱

1. Open Chrome/Twitter/Reddit on your phone
2. Share any URL
3. Select "Basted Pocket"
4. Pick some tags
5. Tap "Save"
6. Check your GitHub repo! 🎉

## Troubleshooting 🔧

**Build fails?**
- Check Java version: `java -version` (need 17+)
- Verify Android SDK path in `local.properties`

**App crashes?**
- Check GitHub token has `repo` scope
- Verify repository exists and is accessible
- Ensure `links.md` file exists in repo

**Can't find in share menu?**
- Reinstall the app
- Clear cache for sharing apps

## What's Next? 🌟

- Bookmark some URLs!
- Organize with hashtags
- Watch your `links.md` file grow
- Consider the roadmap features

**Need help?** Check the main [README.md](README.md) for detailed info.

---

**Happy bookmarking! 🍗📚** 