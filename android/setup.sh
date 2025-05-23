#!/bin/bash

# Basted Pocket Setup Script
# This script helps you configure the app with your GitHub details

set -e

echo "🍗 Welcome to Basted Pocket Setup!"
echo "=================================="
echo ""

# Check if local.properties exists
if [ ! -f "local.properties" ]; then
    echo "❌ Error: local.properties file not found!"
    echo "Please make sure you're running this script from the android project root."
    exit 1
fi

# Backup existing local.properties
cp local.properties local.properties.backup
echo "📄 Backed up existing local.properties to local.properties.backup"

echo ""
echo "Please provide your GitHub configuration:"
echo ""

# Get GitHub PAT
read -s -p "🔑 GitHub Personal Access Token (github_pat_...): " gh_pat
echo ""
if [ -z "$gh_pat" ]; then
    echo "❌ Error: GitHub PAT is required!"
    exit 1
fi

# Get GitHub owner
read -p "👤 GitHub username/organization: " gh_owner
echo ""
if [ -z "$gh_owner" ]; then
    echo "❌ Error: GitHub owner is required!"
    exit 1
fi

# Get GitHub repo
read -p "📁 Repository name: " gh_repo
echo ""
if [ -z "$gh_repo" ]; then
    echo "❌ Error: Repository name is required!"
    exit 1
fi

# Get optional path
read -p "📝 Links file path (default: links.md): " gh_path
if [ -z "$gh_path" ]; then
    gh_path="links.md"
fi

echo ""
echo "⚙️  Updating local.properties..."

# Update local.properties
sed -i "s/ghPat=.*/ghPat=$gh_pat/" local.properties
sed -i "s/ghOwner=.*/ghOwner=$gh_owner/" local.properties
sed -i "s/ghRepo=.*/ghRepo=$gh_repo/" local.properties

# Add or update ghPath
if grep -q "ghPath=" local.properties; then
    sed -i "s/# ghPath=.*/ghPath=$gh_path/" local.properties
    sed -i "s/ghPath=.*/ghPath=$gh_path/" local.properties
else
    echo "ghPath=$gh_path" >> local.properties
fi

echo "✅ Configuration updated successfully!"
echo ""
echo "📋 Your settings:"
echo "   Owner: $gh_owner"
echo "   Repository: $gh_repo"
echo "   Links file: $gh_path"
echo ""

# Check if Java 17 is available
if command -v java >/dev/null 2>&1; then
    java_version=$(java -version 2>&1 | head -n 1 | cut -d'"' -f2 | cut -d'.' -f1)
    if [ "$java_version" -ge 17 ] 2>/dev/null; then
        echo "☕ Java $java_version detected - OK!"
    else
        echo "⚠️  Warning: Java 17+ required for building"
        echo "   Current version: $java_version"
        echo "   Please set JAVA_HOME to Java 17+ before building"
    fi
else
    echo "⚠️  Warning: Java not found in PATH"
fi

echo ""
echo "🚀 Ready to build!"
echo ""
echo "Next steps:"
echo "1. Ensure your repository has a '$gh_path' file"
echo "2. Run: ./gradlew assembleDebug"
echo "3. Install: ./gradlew installDebug"
echo ""
echo "Happy bookmarking! 🍗📚" 