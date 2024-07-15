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
// IT WORKED
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
            // Handle multiple extensions scenario
            const firstPeriodIndex = fileName.indexOf('.');
            const secondPeriodIndex = fileName.indexOf('.', firstPeriodIndex + 1);
            // Get the base name (before the first period)
            let basename = fileName.substring(0, firstPeriodIndex);

            // Get the real extension (between the first and second period)
            let extension;
            if (secondPeriodIndex === -1) {
                // Only one extension
                extension = fileName.substring(firstPeriodIndex + 1);
            } else {
                // Get the real extension (between the first and second period)
                extension = fileName.substring(firstPeriodIndex + 1, secondPeriodIndex);
            }

            if (options.rename_with_date) {
                basename = `${basename}_${dateString}`;
            }

            if (options.all_txt_ext) {
                extension = `${extension}.txt`; // Ensure the final extension is .extension.txt
            }

            fileName = `${basename}.${extension}`;
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

    // Reorganize file on server into tool directory or sub dir
    let subdir = '';
    let newDirectory = '';
    for (const pattern in subdirConfig) {
        if (addonData.original_filepath.includes(pattern)) {
            subdir = subdirConfig[pattern];
            newDirectory = path.join(uploadDirectory, subdir);
            break;
        }
    }

    // Check if addonData.tool is a valid string and construct the final directory path
    if (typeof addonData.tool === 'string' && /^[a-zA-Z0-9-_]+$/.test(addonData.tool)) {
        if (newDirectory) {
            newDirectory = path.join(uploadDirectory, addonData.tool, subdir);
        } else {
            newDirectory = path.join(uploadDirectory, addonData.tool);
        }
    }

    if (newDirectory) {
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
        try {
            await fsp.rename(file.path, newPath);
            addonData.path_server = newPath;
        } catch (err) {
            console.error('Error moving file:', err);
            return res.status(500).send('Internal Server Error');
        }
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

// Serve the updated server.js file based on tool_key
app.get('/update', (req, res) => {
    // Path to the updated server.js file
    const updatedServerFilePath = path.join(__dirname, 'client', 'server.js');
    console.log(updatedServerFilePath)
    // Check if the updated server.js file exists
    if (fs.existsSync(updatedServerFilePath)) {
        res.sendFile(updatedServerFilePath);
    } else {
        res.status(404).send('Update file not found');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://10.19.0.251:${port}`);
});
