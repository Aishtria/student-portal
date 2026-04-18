require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); 
const session = require('express-session');
const path = require('path');
const multer = require('multer');

const app = express();

// --- 1. Middleware & File Storage ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Storage for images (Announcements)
const storage = multer.diskStorage({
    destination: './public/uploads/', 
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

app.use(session({
    secret: 'chcci_final_project_2026',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 60000 * 30 }
}));

// --- 2. Database Connection ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false 
    }
});

pool.connect((err) => {
    if (err) {
        console.error('❌ Database connection error:', err.stack);
    } else {
        console.log('✅ Student Portal connected to Render Postgres!');
    }
});

// --- 3. Authentication Routes ---

app.get('/', (req, res) => {
    res.render('login');
});

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', (req, res) => {
    const { username, password, first_name, last_name, course, year_level, role } = req.body;
    const userSql = 'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id';
    
    pool.query(userSql, [username, password, role], (err, result) => {
        if (err) {
            console.error(err);
            return res.send('<script>alert("ID Number already exists!"); window.history.back();</script>');
        }
        
        const newUserId = result.rows[0].id;
        if (role === 'student') {
            const studentSql = 'INSERT INTO students (user_id, first_name, last_name, course, year_level) VALUES ($1, $2, $3, $4, $5)';
            pool.query(studentSql, [newUserId, first_name, last_name, course, year_level], (err2) => {
                if (err2) return res.send('Error saving student profile.');
                res.send('<script>alert("Student Registration successful!"); window.location.href="/";</script>');
            });
        } else {
            res.send('<script>alert("Staff Registration successful!"); window.location.href="/";</script>');
        }
    });
});

app.post('/login', (req, res) => {
    const { username, password, role } = req.body; 

    const query = `
        SELECT users.*, students.first_name 
        FROM users 
        LEFT JOIN students ON users.id = students.user_id 
        WHERE users.username = $1 AND users.password = $2`;

    pool.query(query, [username, password], (err, results) => {
        if (err) return res.status(500).send("Database error.");

        if (results.rows.length > 0) {
            const user = results.rows[0];

            // 1. Security Check: Block students from using the Admin/Staff toggle
            if (role === 'admin' && user.role === 'student') {
                return res.send('<script>alert("Access Denied: Students cannot login here."); window.location.href="/";</script>');
            }
            
            // 2. Security Check: Block Staff from using the Student toggle
            if (role === 'student' && user.role !== 'student') {
                return res.send('<script>alert("Access Denied: Please use the Admin/Staff toggle."); window.location.href="/";</script>');
            }

            // Set Session Info
            req.session.loggedin = true;
            req.session.userId = user.id; 
            req.session.username = user.username;
            req.session.role = user.role; 
            req.session.displayName = user.first_name || (user.role === 'teacher' ? 'Instructor' : 'Admin');

            // 3. THE REDIRECT LOGIC
            if (user.role === 'admin') {
                res.redirect('/admin-dashboard');
            } else if (user.role === 'teacher') {
                res.redirect('/teacher-dashboard');
            } else if (user.role === 'student') {
                res.redirect('/student-dashboard');
            } else {
                res.redirect('/');
            }
        } else {
            res.send('<script>alert("Invalid Credentials!"); window.location.href="/";</script>');
        }
    });
});

// --- 4. Admin Dashboard & Actions ---

app.get('/admin-dashboard', (req, res) => {
    if (req.session.loggedin && req.session.role === 'admin') {
        const sqlAnnouncements = 'SELECT * FROM announcements ORDER BY id DESC';
        const sqlStudents = 'SELECT * FROM students ORDER BY last_name ASC';
        const sqlSchedules = 'SELECT * FROM class_schedules ORDER BY id DESC';

        pool.query(sqlAnnouncements, (err, ann) => {
            pool.query(sqlStudents, (err2, std) => {
                pool.query(sqlSchedules, (err3, sch) => {
                    res.render('admin-dashboard', { 
                        user: req.session.displayName,
                        announcements: ann ? ann.rows : [],
                        students: std ? std.rows : [],
                        schedules: sch ? sch.rows : [] 
                    });
                });
            });
        });
    } else { res.redirect('/'); }
});

app.post('/post-announcement', upload.array('event_images', 5), (req, res) => {
    if (req.session.loggedin && req.session.role === 'admin') {
        const { title, message } = req.body;
        const filenames = req.files ? req.files.map(file => file.filename) : [];
        const sql = 'INSERT INTO announcements (title, message, image) VALUES ($1, $2, $3)';
        pool.query(sql, [title, message, JSON.stringify(filenames)], () => {
            res.send('<script>alert("Event Published!"); window.location.href="/admin-dashboard";</script>');
        });
    }
});

app.post('/post-schedule', (req, res) => {
    if (req.session.loggedin && req.session.role === 'admin') {
        const { course, year_level, subject_name, day_of_week, start_time, end_time, room } = req.body;
        const sql = 'INSERT INTO class_schedules (course, year_level, subject_code, subject_name, day_of_week, start_time, end_time, room) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';
        pool.query(sql, [course, year_level, "N/A", subject_name, day_of_week, start_time, end_time, room], (err) => {
            if (err) console.error(err);
            res.send('<script>alert("Schedule Posted!"); window.location.href="/admin-dashboard";</script>');
        });
    }
});

// --- 5. Teacher Dashboard & Grading ---

app.get('/teacher-dashboard', (req, res) => {
    if (req.session.loggedin && req.session.role === 'teacher') {
        const studentListSql = 'SELECT id, first_name, last_name FROM students ORDER BY last_name ASC';
        const recentGradesSql = `
            SELECT grades.*, students.first_name, students.last_name 
            FROM grades 
            JOIN students ON grades.student_id = students.id 
            ORDER BY grades.id DESC LIMIT 10`;

        pool.query(studentListSql, (err1, students) => {
            pool.query(recentGradesSql, (err2, recentGrades) => {
                res.render('teacher-dashboard', {
                    user: req.session.displayName,
                    students: students ? students.rows : [],
                    recentGrades: recentGrades ? recentGrades.rows : []
                });
            });
        });
    } else { res.redirect('/'); }
});

app.post('/submit-grade', (req, res) => {
    if (req.session.loggedin && req.session.role === 'teacher') {
        const { student_id, subject_name, grade_value } = req.body;
        const sql = 'INSERT INTO grades (student_id, subject_name, grade_value) VALUES ($1, $2, $3)';
        pool.query(sql, [student_id, subject_name, grade_value], (err) => {
            if (err) return res.status(500).send("Database Error");
            res.send('<script>alert("Grade submitted successfully!"); window.location.href="/teacher-dashboard";</script>');
        });
    } else {
        res.status(403).send("Unauthorized Access");
    }
});

// --- 6. Student Dashboard & Profile ---

app.get('/student-dashboard', (req, res) => {
    if (req.session.loggedin && req.session.role === 'student') {
        pool.query('SELECT * FROM students WHERE user_id = $1', [req.session.userId], (err, result) => {
            if (err || result.rows.length === 0) return res.redirect('/logout');
            
            const student = result.rows[0];
            const scheduleSql = 'SELECT * FROM class_schedules WHERE course = $1 AND year_level = $2';
            const gradeSql = 'SELECT * FROM grades WHERE student_id = $1';
            const announceSql = 'SELECT * FROM announcements ORDER BY id DESC';

            pool.query(scheduleSql, [student.course, student.year_level], (err1, sch) => {
                pool.query(gradeSql, [student.id], (err2, grd) => {
                    pool.query(announceSql, (err3, ann) => {
                        res.render('student-dashboard', {
                            user: req.session.displayName,
                            student: student,
                            schedules: sch ? sch.rows : [],
                            grades: grd ? grd.rows : [],
                            announcements: ann ? ann.rows : []
                        });
                    });
                });
            });
        });
    } else { res.redirect('/'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 7. UTILITY: SUPER RESET ADMIN SETUP ---
app.get('/setup-admin', async (req, res) => {
    try {
        await pool.query("DELETE FROM users WHERE username = $1", ['admin']);
        await pool.query("INSERT INTO users (username, password, role) VALUES ($1, $2, $3)", ['admin', 'admin123', 'admin']);
        res.send("✅ SUCCESS! Admin account RESET. <br>User: admin <br>Pass: admin123 <br><a href='/'>Login</a>");
    } catch (err) {
        res.send("❌ Error: " + err.message);
    }
});

// --- 8. AUTO-TABLE CREATION ---
const initDb = async () => {
    const queryText = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) CHECK (role IN ('admin', 'student', 'teacher')) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        first_name VARCHAR(50),
        last_name VARCHAR(50),
        course VARCHAR(100),
        year_level INTEGER
    );
    CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        image TEXT
    );
    CREATE TABLE IF NOT EXISTS class_schedules (
        id SERIAL PRIMARY KEY,
        course VARCHAR(100),
        year_level INTEGER,
        subject_code VARCHAR(50),
        subject_name VARCHAR(100),
        day_of_week VARCHAR(20),
        start_time TIME,
        end_time TIME,
        room VARCHAR(50)
    );
    CREATE TABLE IF NOT EXISTS grades (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        subject_name VARCHAR(100),
        grade_value DECIMAL(3,2),
        teacher_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;
    try {
        await pool.query(queryText);
        console.log("✅ Database tables are ready!");
    } catch (err) {
        console.error("❌ Error creating tables:", err);
    }
};

initDb();

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));