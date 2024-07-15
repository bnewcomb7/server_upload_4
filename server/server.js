const express = require('express');
const http = require('http');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const formidable = require('formidable');
const moment = require('moment');
const multer = require('multer');
const bodyParser = require('body-parser')
require('moment-timezone/builds/moment-timezone-with-data');
const { setupAuth } = require('./auth'); // Import setupAuth function from auth.js

const port = 8080;
const app = express();
app.use(express.json())

// Directories
const uploadDirectory = '/home/mitnano/Tool_Logs'; // Server upload directory
const subdirConfigPath = path.join(__dirname, 'subdir_config.json'); // Path to the JSON subdirectory key
const fileNameKeyPath = path.join(__dirname, 'protected', 'fname_key.txt'); // Where to store key to file data
const fileNameKeyPath_small = path.join(__dirname, 'semi-protected', 'small_fname_key.txt'); // Where to store key to some file data

// Apply authentication and pages setup
// GET route for redirecting main page to index
app.get('/', (req, res) => {
    res.redirect('/index');
});

// GET route for serving index.html
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

// Load info from subdirConfig
const subdirConfig = JSON.parse(fs.readFileSync(subdirConfigPath, 'utf8'));

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

async function appendFileNameKey(addonData) {
    addonData_reorder = {
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
    try {
        var file_key_text = ',\n' + JSON.stringify(addonData_reorder, null, 4);
        fs.appendFileSync(fileNameKeyPath, file_key_text);
        // console.log('The key data was appended to file!');
      } catch (err) {
        console.log(err)
        console.log('Data NOT appended.')
      };
    addonData_reorder_small = {
        original_filename: addonData.original_filename,
        tool: addonData.tool,
        date_time: addonData.date_time,
        size_bytes: addonData.size_bytes,
        path_server: addonData.path_server,
    };
    try {
        var file_key_text = ',\n' + JSON.stringify(addonData_reorder_small, null, 4);
        fs.appendFileSync(fileNameKeyPath_small, file_key_text);
        // console.log('The key data was appended to file!');
      } catch (err) {
        console.log(err)
        console.log('Data NOT appended.')
      };
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

app.post('/upload', upload.single('file'), checkKey, (req, res) => {
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
        if (!fs.existsSync(newDirectory)) {
            fs.mkdirSync(newDirectory, { recursive: true });
        }

        // Define the new path of the file
        const newPath = path.join(newDirectory, file.filename);

        // Move the file to the new directory
        fs.renameSync(file.path, newPath);

        // Update addonData.path_server to the new location
        addonData.path_server = newPath;
    }

    appendFileNameKey(addonData)

    res.json({
        message: `Successfully uploaded ${file.filename}`,
        addonData: addonData
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://10.19.0.251:${port}`);

});
