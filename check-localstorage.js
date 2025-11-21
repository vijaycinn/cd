const fs = require('fs');
const path = require('path');

// Check if we can access localStorage data
console.log('Checking localStorage values...');

// Since this is Node.js, we can't directly access browser localStorage
// But we can check if the app creates any localStorage files or data

// Check if there's a way to see current localStorage values
console.log('Current environment variables:');
console.log('process.env:', Object.keys(process.env).filter(key => key.includes('LOCAL') || key.includes('STORAGE')));

// Check if there are any files that might contain localStorage data
const appDataPath = process.env.APPDATA || process.env.HOME;
console.log('App data path:', appDataPath);

// Try to read any potential localStorage files
try {
    const files = fs.readdirSync('.');
    console.log('Files in current directory:', files.filter(f => f.includes('local') || f.includes('storage')));
} catch (err) {
    console.log('Error reading directory:', err.message);
}
