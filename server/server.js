const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises; // Import fs.promises for async
const path = require('path');
const moment = require('moment');
const multer = require('multer');
require('moment-timezone/builds/moment-timezone-with-data');
const { setupAuth } = require('./auth'); // Import setupAuth function from auth.js

const port = 8080;
const app = express();
app.use(express.json());

// Directories
const uploadDirectory = '/home/mitnano/Tool_Logs'; // Server upload directory
const subdirConfigPath = path.join(__dirname, 'subdir_config.json'); // Path to the JSON subdirectory key
const fileNameKeyPath = path.join(__dirname, 'protected', 'fname_key.txt'); // Where to store key to file data
const fileNameKeyPath_small = path.join(__dirname, 'semi-protected', 'small_fname_key.txt'); // Where to store key to some file data

// Apply authentication and pages setup
app.get('/', (req, res) => {
    res.redirect('/index');
});

app.get('/index', (req, res) => {
    res.sendFile(path.join(__dirname, 'pages', 'index.html'));
});

setupAuth(app, uploadDirectory);

// User Options
const userInputOptions = {
    key: "jhgfuesgoergb",
    rename_with_date: true,
    tool_key: "server",
    all_txt_ext: true
};

// Function to initialize values with user options or defaults
function initializeOptions(userOptions) {
    const defaultOptions = {
        key: "jhgfuesgoergb",
        rename_with_date: true, // Add datetime to file name in uploads folder
        allowedExtensions: ['.txt', '.log', '.csv', '.xls', '.pdf', '.doc', '.docx', '.jpg', '.png'], // Only save files with these extensions
        tool_key: "unspecified", // User did not specify tool_key in userInputOptions
        all_txt_ext: true // add .txt to file names by default
    };

    return Object.assign({}, defaultOptions, userOptions);
}

// Initialize options
const options = initializeOptions(userInputOptions);

// Load info from subdirConfig synchronously
let subdirConfig;
try {
    subdirConfig = JSON.parse(fs.readFileSync(subdirConfigPath, 'utf8'));
} catch (error) {
    console.error('Failed to read subdir_config.json:', error);
    process.exit(1);
}

// Set up storage engine
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDirectory); // Save files to 'uploads/' directory (resorted later)
    },
    filename: (req, file, cb) => {
        const dateString = moment().tz('America/New_York').format('YYYY-MM-DD_HH-mm-ss');
        let fileName = file.originalname;

    if (options.rename_with_date || options.all_txt_ext) {
        // Find the last period index
        const lastPeriodIndex = fileName.lastIndexOf('.');

        // Check if there is a period in the fileName
        if (lastPeriodIndex !== -1) {
            // Get the basename (anything before the last period)
            let basename = fileName.substring(0, lastPeriodIndex);

            // Get the extension (including the last period and everything after)
            let extension = fileName.substring(lastPeriodIndex);

            if (options.rename_with_date) {
                // Append date string to basename
                basename = `${basename}_${dateString}`;
            }

            if (options.all_txt_ext) {
                // Append .txt to the existing extension
                extension = `${extension}.txt`;
            }

            // Combine basename and extension to form the new fileName
            fileName = `${basename}${extension}`;
        } else {
            // If no period found, handle the fileName without extension
            if (options.rename_with_date) {
                // Just append date string to fileName
                fileName = `${fileName}_${dateString}`;
            }

            if (options.all_txt_ext) {
                // Append .txt as the extension
                fileName = `${fileName}.txt`;
            }
        }
    }


        cb(null, fileName);
    }
});

const upload = multer({ storage: storage, limits: { fileSize: 500 * 1024 * 1024 }});

// Async function to append file name key
async function appendFileNameKey(addonData) {
    const addonDataReorder = {
        new_filename: addonData.new_filename,
        original_filename: addonData.original_filename,
        tool: addonData.tool,
        date_time: addonData.date_time,
        size_bytes: addonData.size_bytes,
        path_server: addonData.path_server,
        original_filepath: addonData.original_filepath,
        original_fileext: addonData.original_fileext,
        timestamp: addonData.timestamp,
        IP: addonData.IP,
        req_headers: addonData.req_headers
    };
    const addonDataReorderSmall = {
        original_filename: addonData.original_filename,
        tool: addonData.tool,
        date_time: addonData.date_time,
        size_bytes: addonData.size_bytes,
        path_server: addonData.path_server,
    };

    try {
        await fsp.appendFile(fileNameKeyPath, ',\n' + JSON.stringify(addonDataReorder, null, 4));
        await fsp.appendFile(fileNameKeyPath_small, ',\n' + JSON.stringify(addonDataReorderSmall, null, 4));
    } catch (err) {
        console.error('Error appending data:', err);
    }
}

async function moveFile(filePath, newPath, maxAttempts = 3, retryInterval = 1000) {
    let attempt = 1;

    while (attempt <= maxAttempts) {
        try {
            const stats = await fsp.stat(filePath);
            const fileSizeInBytes = stats.size;

            // Check if file size is greater than zero to determine if it's ready
            if (fileSizeInBytes > 0) {
                await fsp.rename(filePath, newPath);
                console.log(`File moved successfully from ${filePath} to ${newPath}`);
                return; // Exit function if move was successful
            } else {
                console.log(`Attempt ${attempt}: File is still being written or downloaded. Retrying in ${retryInterval}ms...`);
            }
        } catch (err) {
            console.error(`Attempt ${attempt} - Error moving file:`, err);
        }

        // Increment attempt counter
        attempt++;

        // Wait for retryInterval milliseconds before trying again
        await new Promise(resolve => setTimeout(resolve, retryInterval));
    }

    console.error(`Max attempts (${maxAttempts}) reached. Unable to move file.`);
}

// Custom middleware to check key before uploading file
function checkKey(req, res, next) {
    let addonData;
    try {
        addonData = JSON.parse(req.body.addonData);
    } catch (error) {
        return res.status(400).send('Invalid JSON in addonData');
    }

    if (addonData.key === options.key || addonData.key === "admin_key" || addonData.key === "key.nano") {
        next(); // Key matches, proceed to upload
    } else {
        res.status(403).send('Unauthorized Key'); // Key doesn't match, send forbidden status
    }
}

app.post('/upload', upload.single('file'), checkKey, async (req, res) => {
    let addonData = JSON.parse(req.body.addonData);
    const file = req.file;

    addonData.new_filename = file.filename;
    addonData.path_server = file.path;
    addonData.size_bytes = file.size;
    addonData.IP = req.ip;
    addonData.req_headers = req.headers;

    // Reorganize file on server into tool directory then subdirectory
    let newDirectory = '';
    let org_path = path.normalize(addonData.org_path);

    // Check if addonData.tool is a valid string and construct the final directory path
    if (typeof addonData.tool === 'string' && /^[a-zA-Z0-9-_]+$/.test(addonData.tool)) {
        if (org_path) {
            newDirectory = path.join(uploadDirectory, addonData.tool, org_path);
        } else {
            newDirectory = path.join(uploadDirectory, addonData.tool);
        }
    }

    if (newDirectory) {
        newDirectory = path.normalize(newDirectory).split(path.sep === '/' ? '\\' : '/').join(path.sep);
        // Create the directory if it doesn't exist
        try {
            await fsp.mkdir(newDirectory, { recursive: true });
        } catch (err) {
            console.error('Error creating directory:', err);
            return res.status(500).send('Internal Server Error');
        }

        // Define the new path of the file
        const newPath = path.join(newDirectory, file.filename);
        // Move the file to the new directory
        moveFile(file.path, newPath)
        addonData.path_server = newPath;
    }

    try {
        await appendFileNameKey(addonData);
    } catch (err) {
        console.error('Error appending file name key:', err);
        return res.status(500).send('Internal Server Error');
    }

    res.json({
        message: `Successfully uploaded ${file.filename}`,
        addonData: addonData
    });
});

app.get('/update', (req, res) => {
    // Path to the updated server.js file
    const updatedServerFilePath = path.join(__dirname, 'client', 'server.js');
    const updatedPackageFilePath = path.join(__dirname, 'client', 'package.json');

    // Check if the updated server.js file exists
    if (fs.existsSync(updatedServerFilePath)) {
        // Read the content of the file
        fs.readFile(updatedServerFilePath, 'utf8', (err, data) => {
            if (err) {
                res.status(500).send('Error reading file');
                return;
            }

            // Construct metadata object
            const metadata = {
                update_version: '4.32',
                update_file: data
            };

            // Send metadata as JSON response
            res.json(metadata);
        });
    } else {
        res.status(404).send('Update file not found');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://10.19.0.251:${port}`);
});
