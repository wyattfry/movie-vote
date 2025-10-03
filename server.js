const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.OMDB_API_KEY) {
    console.error('Error: OMDB_API_KEY environment variable is not set, we will not be able to retrieve movie data. See https://www.omdbapi.com/apikey.aspx to get an API key.');
    process.exit(1);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Database setup
const db = new sqlite3.Database('movies.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initDatabase();
    }
});

function initDatabase() {
    // Create movies table
    db.run(`CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        poster_url TEXT,
        local_poster_path TEXT,
        rating REAL,
        year INTEGER,
        suggested_by TEXT,
        suggested_by_cookie TEXT,
        votes INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add new columns to existing databases
    db.run(`ALTER TABLE movies ADD COLUMN suggested_by_cookie TEXT`, (err) => {
        // Ignore error if column already exists
    });

    db.run(`ALTER TABLE movies ADD COLUMN local_poster_path TEXT`, (err) => {
        // Ignore error if column already exists
    });

    // Create movie cache table to store OMDB data and avoid repeated API calls
    db.run(`CREATE TABLE IF NOT EXISTS movie_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title_normalized TEXT UNIQUE NOT NULL,
        omdb_title TEXT,
        plot TEXT,
        poster_url TEXT,
        imdb_rating REAL,
        year INTEGER,
        genre TEXT,
        director TEXT,
        actors TEXT,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create votes table to track who voted for what
    db.run(`CREATE TABLE IF NOT EXISTS user_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER,
        user_cookie TEXT,
        voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (movie_id) REFERENCES movies (id),
        UNIQUE(movie_id, user_cookie)
    )`);

    // Ensure posters directory exists
    fs.ensureDirSync(path.join(__dirname, 'public', 'posters'));

    // Clear old test data and start fresh
    db.run(`DELETE FROM movies`, (err) => {
        if (err) {
            console.error('Error clearing old movies:', err);
        } else {
            console.log('Cleared old movie data for fresh start');
        }
    });

    db.run(`DELETE FROM user_votes`, (err) => {
        if (err) {
            console.error('Error clearing old votes:', err);
        } else {
            console.log('Cleared old vote data for fresh start');
        }
    });
}

// Helper function to normalize movie titles for cache lookup
function normalizeTitle(title) {
    return title.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

// Helper function to generate poster filename
function generatePosterFilename(title, posterUrl) {
    const extension = path.extname(new URL(posterUrl).pathname) || '.jpg';
    const hash = crypto.createHash('md5').update(title + posterUrl).digest('hex');
    return `${hash}${extension}`;
}

// Helper function to download and cache poster
async function downloadAndCachePoster(title, posterUrl) {
    if (!posterUrl || posterUrl === 'N/A') return null;

    try {
        const filename = generatePosterFilename(title, posterUrl);
        const localPath = path.join(__dirname, 'public', 'posters', filename);
        const publicPath = `/posters/${filename}`;

        // Check if poster already exists locally
        if (await fs.pathExists(localPath)) {
            console.log(`Poster already cached: ${filename}`);
            return publicPath;
        }

        // Download the poster
        console.log(`Downloading poster for "${title}": ${posterUrl}`);
        const response = await axios({
            method: 'GET',
            url: posterUrl,
            responseType: 'stream',
            timeout: 10000
        });

        // Save to local file
        const writer = fs.createWriteStream(localPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`Poster cached: ${filename}`);
                resolve(publicPath);
            });
            writer.on('error', (err) => {
                console.error(`Error caching poster: ${err.message}`);
                resolve(null); // Don't fail the whole request for a poster error
            });
        });
    } catch (error) {
        console.error(`Error downloading poster: ${error.message}`);
        return null;
    }
}

// Helper function to get movie data from cache or OMDB
async function getMovieData(title, description) {
    const normalizedTitle = normalizeTitle(title);

    return new Promise((resolve) => {
        // First check cache
        db.get(`SELECT * FROM movie_cache WHERE title_normalized = ?`, [normalizedTitle], async (err, cachedMovie) => {
            if (err) {
                console.error('Cache lookup error:', err);
                resolve({ title, description, poster_url: null, local_poster_path: null, rating: null, year: null });
                return;
            }

            if (cachedMovie) {
                console.log(`Using cached data for "${title}"`);
                // Use cached poster path if available, otherwise try to download
                let localPosterPath = null;
                if (cachedMovie.poster_url) {
                    localPosterPath = await downloadAndCachePoster(cachedMovie.omdb_title || title, cachedMovie.poster_url);
                }

                resolve({
                    title: cachedMovie.omdb_title || title,
                    description: cachedMovie.plot || description,
                    poster_url: cachedMovie.poster_url,
                    local_poster_path: localPosterPath,
                    rating: cachedMovie.imdb_rating,
                    year: cachedMovie.year
                });
                return;
            }

            // Not in cache, fetch from OMDB
            try {
                const searchResponse = await axios.get(`http://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&t=${encodeURIComponent(title)}&type=movie`);

                if (searchResponse.data && searchResponse.data.Response === 'True') {
                    const movie = searchResponse.data;
                    console.log(`Fetched from OMDB: "${movie.Title}"`);

                    // Cache the movie data
                    db.run(`INSERT OR REPLACE INTO movie_cache 
                           (title_normalized, omdb_title, plot, poster_url, imdb_rating, year, genre, director, actors) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            normalizedTitle,
                            movie.Title,
                            movie.Plot !== 'N/A' ? movie.Plot : null,
                            movie.Poster !== 'N/A' ? movie.Poster : null,
                            movie.imdbRating !== 'N/A' ? parseFloat(movie.imdbRating) : null,
                            movie.Year !== 'N/A' ? parseInt(movie.Year) : null,
                            movie.Genre !== 'N/A' ? movie.Genre : null,
                            movie.Director !== 'N/A' ? movie.Director : null,
                            movie.Actors !== 'N/A' ? movie.Actors : null
                        ]);

                    // Download and cache poster
                    const localPosterPath = await downloadAndCachePoster(movie.Title, movie.Poster);

                    resolve({
                        title: movie.Title,
                        description: movie.Plot !== 'N/A' ? movie.Plot : description,
                        poster_url: movie.Poster !== 'N/A' ? movie.Poster : null,
                        local_poster_path: localPosterPath,
                        rating: movie.imdbRating !== 'N/A' ? parseFloat(movie.imdbRating) : null,
                        year: movie.Year !== 'N/A' ? parseInt(movie.Year) : null
                    });
                } else {
                    console.log(`No OMDB data found for "${title}"`);
                    resolve({ title, description, poster_url: null, local_poster_path: null, rating: null, year: null });
                }
            } catch (error) {
                console.log('OMDB API error:', error.message);
                resolve({ title, description, poster_url: null, local_poster_path: null, rating: null, year: null });
            }
        });
    });
}

// Generate unique cookie for users
function getUserCookie(req, res) {
    let userCookie = req.cookies.movieVoteUser;
    if (!userCookie) {
        userCookie = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        res.cookie('movieVoteUser', userCookie, { maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days
    }
    return userCookie;
}

// Routes
app.get('/', (req, res) => {
    const userCookie = getUserCookie(req, res);

    db.all(`SELECT m.*, 
            CASE WHEN uv.user_cookie IS NOT NULL THEN 1 ELSE 0 END as user_voted,
            CASE WHEN m.suggested_by_cookie = ? THEN 1 ELSE 0 END as user_suggested
            FROM movies m 
            LEFT JOIN user_votes uv ON m.id = uv.movie_id AND uv.user_cookie = ?
            ORDER BY m.votes DESC, m.created_at DESC`, [userCookie, userCookie], (err, movies) => {
        if (err) {
            console.error(err);
            res.status(500).send('Database error');
            return;
        }
        res.render('index', { movies, userCookie });
    });
});

// Search movies (for confirmation before adding)
app.post('/search-movie', async (req, res) => {
    const { title } = req.body;

    if (!title) {
        return res.status(400).json({ error: 'Movie title is required' });
    }

    try {
        // Search for multiple results first
        const searchResponse = await axios.get(`http://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&s=${encodeURIComponent(title)}&type=movie`);

        if (searchResponse.data && searchResponse.data.Response === 'True' && searchResponse.data.Search) {
            // Get detailed info for top 3 matches
            const searchResults = searchResponse.data.Search.slice(0, 3);
            const detailedResults = [];

            for (const result of searchResults) {
                try {
                    const detailResponse = await axios.get(`http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${result.imdbID}`);
                    if (detailResponse.data && detailResponse.data.Response === 'True') {
                        detailedResults.push({
                            imdbID: detailResponse.data.imdbID,
                            title: detailResponse.data.Title,
                            year: detailResponse.data.Year,
                            plot: detailResponse.data.Plot !== 'N/A' ? detailResponse.data.Plot : '',
                            poster: detailResponse.data.Poster !== 'N/A' ? detailResponse.data.Poster : null,
                            rating: detailResponse.data.imdbRating !== 'N/A' ? detailResponse.data.imdbRating : null,
                            genre: detailResponse.data.Genre !== 'N/A' ? detailResponse.data.Genre : '',
                            director: detailResponse.data.Director !== 'N/A' ? detailResponse.data.Director : '',
                            actors: detailResponse.data.Actors !== 'N/A' ? detailResponse.data.Actors : ''
                        });
                    }
                } catch (error) {
                    console.log(`Error fetching details for ${result.Title}:`, error.message);
                }
            }

            if (detailedResults.length > 0) {
                res.json({ success: true, movies: detailedResults });
            } else {
                res.json({ success: false, error: 'No detailed movie information found' });
            }
        } else {
            res.json({ success: false, error: 'No movies found matching your search' });
        }
    } catch (error) {
        console.error('OMDB search error:', error.message);
        res.json({ success: false, error: 'Failed to search movies' });
    }
});

// Add movie suggestion
app.post('/suggest', async (req, res) => {
    const { title, description, suggested_by } = req.body;
    const userCookie = getUserCookie(req, res);

    if (!title || !suggested_by) {
        return res.status(400).json({ error: 'Title and suggester name are required' });
    }

    try {
        // Get movie data using optimized caching system
        const movieData = await getMovieData(title, description);

        // Use local poster path if available, otherwise fall back to external URL
        const finalPosterUrl = movieData.local_poster_path || movieData.poster_url;

        db.run(`INSERT INTO movies (title, description, poster_url, local_poster_path, rating, year, suggested_by, suggested_by_cookie) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [movieData.title, movieData.description, movieData.poster_url, movieData.local_poster_path, movieData.rating, movieData.year, suggested_by, userCookie],
            function (err) {
                if (err) {
                    console.error(err);
                    res.status(500).json({ error: 'Database error' });
                    return;
                }
                res.json({ success: true, movieId: this.lastID });
            });
    } catch (error) {
        console.error('Error adding movie suggestion:', error);
        res.status(500).json({ error: 'Failed to add movie suggestion' });
    }
});

// Vote for movie
app.post('/vote/:id', (req, res) => {
    const movieId = parseInt(req.params.id);
    const userCookie = getUserCookie(req, res);

    // Check if user already voted for this movie
    db.get(`SELECT * FROM user_votes WHERE movie_id = ? AND user_cookie = ?`,
        [movieId, userCookie], (err, existingVote) => {
            if (err) {
                console.error(err);
                res.status(500).json({ error: 'Database error' });
                return;
            }

            if (existingVote) {
                res.status(400).json({ error: 'You have already voted for this movie' });
                return;
            }

            // Add vote
            db.run(`INSERT INTO user_votes (movie_id, user_cookie) VALUES (?, ?)`,
                [movieId, userCookie], (err) => {
                    if (err) {
                        console.error(err);
                        res.status(500).json({ error: 'Database error' });
                        return;
                    }

                    // Update movie vote count
                    db.run(`UPDATE movies SET votes = votes + 1 WHERE id = ?`, [movieId], (err) => {
                        if (err) {
                            console.error(err);
                            res.status(500).json({ error: 'Database error' });
                            return;
                        }
                        res.json({ success: true });
                    });
                });
        });
});

// Remove vote (optional feature)
app.delete('/vote/:id', (req, res) => {
    const movieId = parseInt(req.params.id);
    const userCookie = getUserCookie(req, res);

    db.run(`DELETE FROM user_votes WHERE movie_id = ? AND user_cookie = ?`,
        [movieId, userCookie], function (err) {
            if (err) {
                console.error(err);
                res.status(500).json({ error: 'Database error' });
                return;
            }

            if (this.changes === 0) {
                res.status(400).json({ error: 'No vote found to remove' });
                return;
            }

            // Update movie vote count
            db.run(`UPDATE movies SET votes = votes - 1 WHERE id = ?`, [movieId], (err) => {
                if (err) {
                    console.error(err);
                    res.status(500).json({ error: 'Database error' });
                    return;
                }
                res.json({ success: true });
            });
        });
});

// Delete movie (only by the person who suggested it)
app.delete('/movie/:id', (req, res) => {
    const movieId = parseInt(req.params.id);
    const userCookie = getUserCookie(req, res);

    // Check if the user is the one who suggested this movie
    db.get(`SELECT * FROM movies WHERE id = ? AND suggested_by_cookie = ?`,
        [movieId, userCookie], (err, movie) => {
            if (err) {
                console.error(err);
                res.status(500).json({ error: 'Database error' });
                return;
            }

            if (!movie) {
                res.status(403).json({ error: 'You can only delete movies you suggested' });
                return;
            }

            // Delete all votes for this movie first
            db.run(`DELETE FROM user_votes WHERE movie_id = ?`, [movieId], (err) => {
                if (err) {
                    console.error(err);
                    res.status(500).json({ error: 'Database error' });
                    return;
                }

                // Delete the movie
                db.run(`DELETE FROM movies WHERE id = ?`, [movieId], function (err) {
                    if (err) {
                        console.error(err);
                        res.status(500).json({ error: 'Database error' });
                        return;
                    }

                    if (this.changes === 0) {
                        res.status(404).json({ error: 'Movie not found' });
                        return;
                    }

                    res.json({ success: true });
                });
            });
        });
});

// Start server
app.listen(port, () => {
    console.log(`Movie voting app running at http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database closed.');
        }
        process.exit(0);
    });
});
