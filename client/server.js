const express = require('express');
const http = require('http');
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');
const moment = require('moment');
const { exec } = require('child_process');
require('moment-timezone/builds/moment-timezone-with-data');

const version = 4.2; // version of this file, update version is specified in server side code (app.get('/update'...))
const port = 8080;
const app = express();
app.use(express.json());

// Directories
// Read configuration from config.json
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const uploadDirectory = `http://10.19.0.251:${port}/upload`; // Server upload directory
const targetDirectories = config.targetDirectories.map(dir =>
    path.join(...dir.split(path.sep))
);

// User Options
const userInputOptions = {
    key: "jhgfuesgoergb",
    checkInterval: parseFloat(config.checkInterval),
    uploadInterval: parseFloat(config.uploadInterval),
    rename_with_date: false, // keep false, done on server side
    upload_existing_files: false,
    tool_key: config.tool_key,
    all_txt_ext: false, // keep false, done on server side
};

// Function to initialize values with user options or defaults
function initializeOptions(userOptions) {
    const defaultOptions = {
        key: "jhgfuesgoergb",
        checkInterval: 60 * 1000, // Check every 60 seconds
        uploadInterval: 24 * 60 * 60 * 1000, // Upload every 24 hours
        updateCheckInterval: 28 * 60 * 60 * 1000, // Check for updates every 24 hours
        rename_with_date: false, // Add datetime to file name in uploads folder
        upload_existing_files: false, // Save files already in targetDirectory on start
        allowedExtensions: ['.txt', '.log', '.csv', '.xls', '.xlsx', '.pdf', '.doc', '.docx', '.jpg', '.png'], // Only save files with these extensions
        tool_key: "unspecified", // User did not specify tool_key in userInputOptions
        all_txt_ext: false // Add .txt to file names by default
    };

    return Object.assign({}, defaultOptions, userOptions);
}

// Initialize options
const options = initializeOptions(userInputOptions);

let previousFiles = {};
let changedFiles = [];
let addonData = {};
let initialized = false;
let directories_initialized = 0;

// Initialize previousFiles for each target directory
targetDirectories.forEach(directory => {
    previousFiles[directory] = [];
});

if (!fs.existsSync(uploadDirectory)) {
    console.log(`Warning: Need to create or change upload directory. ${uploadDirectory}`);
}
targetDirectories.forEach(directory => {
    if (!fs.existsSync(directory)) {
        console.log(`Warning: Need to create or change target directory. ${directory}`);
    }
});

// Recursively get files from a directory
function getFilesRecursively(directory) {
    let files = [];

    fs.readdirSync(directory).forEach(file => {
        const fullPath = path.join(directory, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            files = files.concat(getFilesRecursively(fullPath));
        } else {
            files.push({ name: file, path: fullPath, mtime: stats.mtimeMs });
        }
    });

    return files;
}

// Check for changes in the target directories
function checkForChanges() {
    targetDirectories.forEach(targetDirectory => {
        let currentFiles = getFilesRecursively(targetDirectory).map(file => {
            return {
                name: file.name,
                path: file.path,
                mtime: file.mtime,
                directory: path.dirname(file.path).replace(targetDirectory, '')
            };
        });

        // Initialize previousFiles if empty
        if (!initialized && !options.upload_existing_files) {
            previousFiles[targetDirectory] = [...currentFiles];

            directories_initialized++;
            if (!initialized && directories_initialized === targetDirectories.length) {
                initialized = true;
            }
            return;
        }

        // Determine new or updated files
        let updates = currentFiles.filter(file => {
            let prev = (previousFiles[targetDirectory] || []).find(f => f.path === file.path);
            return !prev || file.mtime > prev.mtime;
        });

        if (updates.length > 0) {
            updates.forEach(file => {
                if (!changedFiles.find(f => f.path === file.path)) {
                    // Check if the file extension is allowed
                    const fileExtension = path.extname(file.name);
                    if (options.allowedExtensions.includes(fileExtension.toLowerCase())) {
                        changedFiles.push(file);
                    } else {
                        console.log(`File '${file.name}' in '${file.directory}' has an invalid extension and will not be uploaded.`);
                    }
                }
            });
            console.log('Detected new or updated files:', updates.map(f => `${f.directory}/${f.name}`));
        }
        previousFiles[targetDirectory] = [...currentFiles];
    });
}

// Upload a file from changedFiles
function uploadFromTarget() {
    if (changedFiles.length === 0) {
        console.log('No files to upload.');
        return;
    }

    while (changedFiles.length > 0) {
        let file = changedFiles.shift();
        let sourcePath = file.path;

        uploadFile(sourcePath, uploadDirectory, file, addonData);
        console.log(`Files waiting to upload: ${changedFiles.map(f => `${f.directory}/${f.name}`)}`);
    }

    console.log('All changed files have been processed for upload.');
}

async function uploadFile(filePath, uploadUrl, file, addonData) {
    try {
        // Read file content asynchronously
        const fileBuffer = await fs.promises.readFile(filePath);

        // Create a new FormData instance
        const formData = new FormData();

        // Get the current time in Eastern Time (ET) using Moment.js
        const dateString = moment().tz('America/New_York').format('YYYY-MM-DD_HH-mm-ss');
        const fileExtension = path.extname(file.name);

        addonData.original_filename = file.name;
        addonData.original_filepath = filePath;
        addonData.original_fileext = fileExtension;
        addonData.tool = options.tool_key;
        addonData.timestamp = moment().valueOf();
        addonData.date_time = dateString;
        addonData.key = options.key;

        // Include subdirectory structure in file name
        let subDirPath = file.directory.split(path.sep).filter(part => part).join('-');
        let newFileName = subDirPath ? `${subDirPath}-${file.name}` : file.name;

        if (options.rename_with_date) {
            newFileName = `${dateString}_${path.basename(newFileName, fileExtension)}${fileExtension}`;
        }
        if (options.all_txt_ext) {
            newFileName = `${newFileName}.txt`;
        }

        // Append file and addonData to formData
        formData.append('file', fileBuffer, newFileName);
        formData.append('addonData', JSON.stringify(addonData));
        formData.append('tool_key', options.tool_key);
        formData.append('rename_with_date', options.rename_with_date.toString());
        formData.append('all_txt_ext', options.all_txt_ext.toString());

        // Perform the fetch request to upload the file
        const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData, // Automatically sets 'Content-Type': 'multipart/form-data'
        });

        // Check the response
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }

        console.log(`Successfully uploaded ${newFileName}`);
    } catch (error) {
        console.error('Error uploading file:', error);
    }
}

function checkForUpdate() {
    const updateServerUrl = `http://10.19.0.251:${port}/update`;

    http.get(updateServerUrl, (res) => {
        if (res.statusCode !== 200) {
            console.error(`Failed to get update, status code: ${res.statusCode}`);
            return;
        }
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            try {
                const jsonResponse = JSON.parse(data);
                const { update_version, update_file } = jsonResponse;
                // console.log(update_version, update_file);
                if (version === parseFloat(update_version)) {
                    console.log(`Version ${update_version}: Up to date.`);
                    return;
                }
                // Write the file content to a temporary file
                const tempFileName = 'server_temp.js';
                fs.writeFile(tempFileName, update_file, (writeErr) => {
                    if (writeErr) {
                        console.error('Error writing temporary file:', writeErr);
                        return;
                    }

                    // Rename the temporary file to server.js
                    fs.rename(tempFileName, 'server.js', (renameErr) => {
                        if (renameErr) {
                            console.error('Error renaming file:', renameErr);
                            return;
                        }

                        console.log(`Update to version ${version} complete`);
                        restartServer();
                    });
                });
            } catch (parseErr) {
                console.error('Error parsing JSON response:', parseErr);
            }
        });
    })
}

// requires windows task scheduler that runs pm2 restart server as admin (with name RestartPM2Server)
function restartServer() {
    exec('schtasks /run /tn "RestartPM2Server"', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error restarting server: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Error: ${stderr}`);
            return;
        }
        console.log(`Server restarted: ${stdout}`);
    });
}

app.get('/upload', (req, res) => {
    // Handle GET requests to /upload route
    res.send('GET request to /upload endpoint.');
});

console.log(`Server running at http://10.19.0.251:${port}\n`);
console.log('Monitoring files saved to the following directories:');
targetDirectories.forEach(directory => console.log(directory));

// Call checkForChanges to initialize previousFiles with the files in the target directories
checkForChanges();

// Set intervals for checking changes and uploading files
setInterval(checkForChanges, options.checkInterval);
setInterval(uploadFromTarget, options.uploadInterval);
setInterval(checkForUpdate, options.updateCheckInterval);
