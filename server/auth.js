// auth.js
const express = require('express');
const session = require('express-session');
const http = require('http');
const serveIndex = require('serve-index');
const basicAuth = require('basic-auth');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const formidable = require('formidable');
const bodyParser = require('body-parser')
require('moment-timezone/builds/moment-timezone-with-data');

function readLogins() {
    const loginsData = fs.readFileSync('logins.json');
    return JSON.parse(loginsData);
}

function setupAuth(app, uploadDirectory) {
    const logins = readLogins();

    // Session middleware setup
    app.use(session({
        secret: 'key.nano', 
        resave: false,
        saveUninitialized: false, // ensure session is not saved until modified
        cookie: { maxAge: 30 * 60 * 1000 } // 30 minutes
    }));

    const auth = (req, res, next) => {
        const credentials = basicAuth(req);

        // Check if credentials are valid
        if (!credentials || !isValidUser(req, credentials.name, credentials.pass)) {
            res.set('WWW-Authenticate', 'Basic realm="Authorization Required"');
            return res.sendStatus(401);
        }

        // If credentials are correct, proceed and refresh session expiration
        req.session.regenerate(err => {
            if (err) {
                return res.sendStatus(500);
            }
            req.session.user = credentials.name;
            next();
        });
    };

    function isValidUser(req, username, password) {
        const user = logins.find(user => user.username === username && user.password === password);
        if (!user) return false;

        // Check permissions
        if (user.permissions === 'all') {
            return true; // User has permission to access everything
        } else if (user.permissions === 'none') {
            // Allow access to /index and /table only
            return false;
        }

        return false; // Default: deny access
    }

    app.get('/auth/check', (req, res) => {
        if (req.session.user) {
            res.json({ username: req.session.user });
        } else {
            res.sendStatus(401);
        }
    });

    app.post('/logout', (req, res) => {
        req.session.destroy(err => {
            if (err) {
                return res.status(500).send('Failed to log out');
            }
            res.sendStatus(200);
        });
    });

    // Allow CORS for all routes
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
        next();
    });

    // Apply auth middleware to the /explorer and /public routes
    app.use('/public', auth, express.static('public'), serveIndex('public', { 'icons': true }));
    app.use('/protected', auth, express.static('protected'), serveIndex('protected', { 'icons': true }));
    app.use('/explorer', auth, express.static(uploadDirectory), serveIndex(uploadDirectory, { 'icons': true }));

    // Example route with permissions
    app.get('/index', auth, (req, res) => {
        res.sendFile(path.join(__dirname, 'pages', 'index.html'));
    });

    app.get('/table', auth, (req, res) => {
        res.sendFile(path.join(__dirname, 'pages', 'file_table.html'));
    });

    // Parse URL-encoded bodies
    app.use(express.urlencoded({ extended: true }));
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());
}

module.exports = { setupAuth };
