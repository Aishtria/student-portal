require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const path = require('path');
const multer = require('multer');

const app = express();

// --- 1. Middleware & File Storage ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

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
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'student_portal'
});

db.connect(err => {
    if (err) {
        console.error('❌ Database error: ' + err.message);
        return;
    }
    console.log('✅ Student Portal Database Connected!');
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
    const userSql = 'INSERT INTO users (username, password, role) VALUES (?, ?, ?)';
    
    db.query(userSql, [username, password, role], (err, result) => {
        if (err) {
            console.error(err);
            return res.send('<script>alert("ID Number already exists!"); window.history.back();</script>');
        }
        
        const newUserId = result.insertId;
        if (role === 'student') {
            const studentSql = 'INSERT INTO students (user_id, first_name, last_name, course, year_level) VALUES (?, ?, ?, ?, ?)';
            db.query(studentSql, [newUserId, first_name, last_name, course, year_level], (err2) => {
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
        WHERE users.username = ? AND users.password = ?`;

    db.query(query, [username, password], (err, results) => {
        if (err) return res.status(500).send("Database error.");

        if (results.length > 0) {
            const user = results[0];

            if (role === 'student' && user.role !== 'student') {
                return res.send('<script>alert("Access Denied: Use the Admin/Staff toggle."); window.location.href="/";</script>');
            } 
            
            if (role === 'admin' && (user.role !== 'admin' && user.role !== 'teacher')) {
                return res.send('<script>alert("Access Denied: Students cannot login here."); window.location.href="/";</script>');
            }

            req.session.loggedin = true;
            req.session.userId = user.id; 
            req.session.username = user.username;
            req.session.role = user.role;
            req.session.displayName = user.first_name || (user.role === 'teacher' ? 'Instructor' : 'Admin');

            if (user.role === 'admin') {
                res.redirect('/admin-dashboard');
            } else if (user.role === 'teacher') {
                res.redirect('/teacher-dashboard');
            } else {
                res.redirect('/student-dashboard');
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

        db.query(sqlAnnouncements, (err, ann) => {
            db.query(sqlStudents, (err2, std) => {
                db.query(sqlSchedules, (err3, sch) => {
                    res.render('admin-dashboard', { 
                        user: req.session.displayName,
                        announcements: ann || [],
                        students: std || [],
                        schedules: sch || [] 
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
        const sql = 'INSERT INTO announcements (title, message, image) VALUES (?, ?, ?)';
        db.query(sql, [title, message, JSON.stringify(filenames)], () => {
            res.send('<script>alert("Event Published!"); window.location.href="/admin-dashboard";</script>');
        });
    }
});

app.post('/post-schedule', (req, res) => {
    if (req.session.loggedin && req.session.role === 'admin') {
        const { course, year_level, subject_name, day_of_week, start_time, end_time, room } = req.body;
        const sql = 'INSERT INTO class_schedules (course, year_level, subject_name, day_of_week, start_time, end_time, room) VALUES (?, ?, ?, ?, ?, ?, ?)';
        db.query(sql, [course, year_level, subject_name, day_of_week, start_time, end_time, room], () => {
            res.send('<script>alert("Schedule Posted!"); window.location.href="/admin-dashboard";</script>');
        });
    }
});

// --- 5. Teacher Dashboard & Grading ---

app.get('/teacher-dashboard', (req, res) => {
    if (req.session.loggedin && req.session.role === 'teacher') {
        const studentListSql = 'SELECT id, first_name, last_name FROM students ORDER BY last_name ASC';
        const recentGradesSql = `SELECT grades.*, students.first_name, students.last_name FROM grades JOIN students ON grades.student_id = students.id ORDER BY grades.id DESC LIMIT 10`;

        db.query(studentListSql, (err1, students) => {
            db.query(recentGradesSql, (err2, recentGrades) => {
                res.render('teacher-dashboard', {
                    user: req.session.displayName,
                    students: students || [],
                    recentGrades: recentGrades || []
                });
            });
        });
    } else { res.redirect('/'); }
});

app.post('/submit-grade', (req, res) => {
    if (req.session.loggedin && req.session.role === 'teacher') {
        const { student_id, subject_name, grade_value } = req.body;
        const sql = 'INSERT INTO grades (student_id, subject_name, grade_value) VALUES (?, ?, ?)';
        db.query(sql, [student_id, subject_name, grade_value], (err) => {
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
        db.query('SELECT * FROM students WHERE user_id = ?', [req.session.userId], (err, result) => {
            if (err || result.length === 0) return res.redirect('/logout');
            
            const student = result[0]; // This contains course, year_level, etc.
            const scheduleSql = 'SELECT * FROM class_schedules WHERE course = ? AND year_level = ?';
            const gradeSql = 'SELECT * FROM grades WHERE student_id = ?';
            const announceSql = 'SELECT * FROM announcements ORDER BY id DESC';

            db.query(scheduleSql, [student.course, student.year_level], (err1, sch) => {
                db.query(gradeSql, [student.id], (err2, grd) => {
                    db.query(announceSql, (err3, ann) => {
                        res.render('student-dashboard', {
                            user: req.session.displayName,
                            student: student, // <--- PASS THE STUDENT OBJECT HERE
                            schedules: sch || [],
                            grades: grd || [],
                            announcements: ann || []
                        });
                    });
                });
            });
        });
    } else { res.redirect('/'); }
});

// FIXED: Added student-profile route
app.get('/student-profile', (req, res) => {
    if (req.session.loggedin && req.session.role === 'student') {
        const sql = 'SELECT * FROM students WHERE user_id = ?';
        db.query(sql, [req.session.userId], (err, result) => {
            if (err || result.length === 0) return res.send("Error loading profile.");
            res.render('student-profile', { 
                user: req.session.displayName,
                studentData: result[0], 
                username: req.session.username 
            });
        });
    } else { res.redirect('/'); }
});

// FIXED: Added courses route for students
app.get('/courses', (req, res) => {
    if (req.session.loggedin && req.session.role === 'student') {
        const sql = 'SELECT * FROM class_schedules';
        db.query(sql, (err, results) => {
            if (err) return res.send("Error fetching courses.");
            res.render('courses', { 
                user: req.session.displayName,
                courses: results 
            });
        });
    } else { res.redirect('/'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));