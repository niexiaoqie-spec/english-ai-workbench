import aiosqlite
import os
from datetime import datetime, timezone

# Use persistent volume path on Railway, local path for development
if os.path.isdir("/data"):
    DB_PATH = "/data/english_workbench.db"
else:
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "english_workbench.db")


async def get_db():
    """Get an aiosqlite database connection."""
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    """Initialize the database schema."""
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS vocabulary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word TEXT NOT NULL,
                phonetic TEXT DEFAULT '',
                definition TEXT DEFAULT '',
                definition_cn TEXT DEFAULT '',
                example_sentence TEXT DEFAULT '',
                context TEXT DEFAULT '',
                difficulty INTEGER DEFAULT 3,
                mastery REAL DEFAULT 0,
                created_at TEXT DEFAULT '',
                last_reviewed TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS srs_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_type TEXT DEFAULT 'word',
                front TEXT NOT NULL,
                back TEXT NOT NULL,
                extra TEXT DEFAULT '',
                stability REAL DEFAULT 0.5,
                difficulty REAL DEFAULT 5.0,
                due TEXT DEFAULT '',
                last_review TEXT DEFAULT '',
                reps INTEGER DEFAULT 0,
                lapses INTEGER DEFAULT 0,
                state TEXT DEFAULT 'new'
            );

            CREATE TABLE IF NOT EXISTS reading_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT DEFAULT '',
                content TEXT DEFAULT '',
                source_url TEXT DEFAULT '',
                word_count INTEGER DEFAULT 0,
                new_words INTEGER DEFAULT 0,
                comprehension_score REAL DEFAULT 0,
                created_at TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS speaking_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario TEXT DEFAULT '',
                messages TEXT DEFAULT '[]',
                score REAL DEFAULT 0,
                feedback TEXT DEFAULT '',
                created_at TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS listening_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT DEFAULT '',
                content TEXT DEFAULT '',
                source_url TEXT DEFAULT '',
                duration_seconds INTEGER DEFAULT 0,
                comprehension_score REAL DEFAULT 0,
                created_at TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS daily_words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                word TEXT NOT NULL,
                phonetic TEXT DEFAULT '',
                pos TEXT DEFAULT '',
                definition TEXT DEFAULT '',
                definition_cn TEXT DEFAULT '',
                collocations TEXT DEFAULT '',
                example TEXT DEFAULT '',
                example_cn TEXT DEFAULT '',
                mnemonic TEXT DEFAULT '',
                category TEXT DEFAULT '',
                difficulty INTEGER DEFAULT 3,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS daily_quiz (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                word TEXT NOT NULL,
                question_type TEXT NOT NULL,
                question TEXT NOT NULL,
                options TEXT DEFAULT '',
                answer INTEGER DEFAULT 0,
                user_answer INTEGER,
                is_correct INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS daily_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                words_generated INTEGER DEFAULT 0,
                words_reviewed INTEGER DEFAULT 0,
                quiz_score INTEGER DEFAULT 0,
                quiz_total INTEGER DEFAULT 0,
                completed INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
        """)
        await db.commit()
    finally:
        await db.close()


def now_iso():
    """Return current UTC time as ISO string."""
    return datetime.now(timezone.utc).isoformat()


# --- Vocabulary CRUD ---

async def add_vocabulary(word, phonetic="", definition="", definition_cn="",
                         example_sentence="", context="", difficulty=3):
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO vocabulary (word, phonetic, definition, definition_cn,
               example_sentence, context, difficulty, mastery, created_at, last_reviewed)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, '')""",
            (word, phonetic, definition, definition_cn, example_sentence,
             context, difficulty, now_iso())
        )
        await db.commit()
        return cursor.lastrowid
    finally:
        await db.close()


async def get_vocabulary_by_id(vocab_id):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM vocabulary WHERE id = ?", (vocab_id,))
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        await db.close()


async def get_vocabulary_by_word(word):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM vocabulary WHERE word = ?", (word,))
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        await db.close()


async def list_vocabulary(search="", sort_by="created_at"):
    db = await get_db()
    try:
        if sort_by not in ("mastery", "created_at", "difficulty"):
            sort_by = "created_at"
        query = "SELECT * FROM vocabulary"
        params = []
        if search:
            query += " WHERE word LIKE ? OR definition LIKE ? OR definition_cn LIKE ?"
            like = f"%{search}%"
            params = [like, like, like]
        query += f" ORDER BY {sort_by} DESC"
        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def update_vocabulary(vocab_id, **fields):
    db = await get_db()
    try:
        allowed = {"word", "phonetic", "definition", "definition_cn",
                   "example_sentence", "context", "difficulty", "mastery", "last_reviewed"}
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [vocab_id]
        cursor = await db.execute(
            f"UPDATE vocabulary SET {set_clause} WHERE id = ?", values
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


async def delete_vocabulary(vocab_id):
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM vocabulary WHERE id = ?", (vocab_id,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# --- SRS Cards CRUD ---

async def add_srs_card(card_type="word", front="", back="", extra=""):
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO srs_cards (card_type, front, back, extra, stability,
               difficulty, due, last_review, reps, lapses, state)
               VALUES (?, ?, ?, ?, 0.5, 5.0, ?, '', 0, 0, 'new')""",
            (card_type, front, back, extra, now_iso())
        )
        await db.commit()
        return cursor.lastrowid
    finally:
        await db.close()


async def get_srs_card(card_id):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM srs_cards WHERE id = ?", (card_id,))
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        await db.close()


async def get_srs_card_by_front(front):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM srs_cards WHERE front = ?", (front,))
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        await db.close()


async def update_srs_card(card_id, **fields):
    db = await get_db()
    try:
        allowed = {"card_type", "front", "back", "extra", "stability",
                   "difficulty", "due", "last_review", "reps", "lapses", "state"}
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [card_id]
        cursor = await db.execute(
            f"UPDATE srs_cards SET {set_clause} WHERE id = ?", values
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


async def delete_srs_card(card_id):
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM srs_cards WHERE id = ?", (card_id,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


async def delete_srs_card_by_front(front):
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM srs_cards WHERE front = ?", (front,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


async def get_due_cards():
    db = await get_db()
    try:
        now = now_iso()
        cursor = await db.execute(
            "SELECT * FROM srs_cards WHERE due <= ? ORDER BY due ASC", (now,)
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_srs_stats():
    db = await get_db()
    try:
        now = now_iso()
        today_start = datetime.now(timezone.utc).strftime("%Y-%m-%d") + "T00:00:00"

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM srs_cards")
        total = (await cursor.fetchone())["cnt"]

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM srs_cards WHERE state = 'new'")
        new_count = (await cursor.fetchone())["cnt"]

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM srs_cards WHERE state = 'learning'")
        learning_count = (await cursor.fetchone())["cnt"]

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM srs_cards WHERE state = 'review'")
        review_count = (await cursor.fetchone())["cnt"]

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM srs_cards WHERE due <= ?", (now,))
        due_today = (await cursor.fetchone())["cnt"]

        cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM srs_cards WHERE last_review >= ?", (today_start,)
        )
        reviewed_today = (await cursor.fetchone())["cnt"]

        return {
            "total_cards": total,
            "new_count": new_count,
            "learning_count": learning_count,
            "review_count": review_count,
            "due_today": due_today,
            "reviewed_today": reviewed_today,
        }
    finally:
        await db.close()


# --- Reading History CRUD ---

async def add_reading_history(title, content, source_url, word_count, new_words, comprehension_score=0):
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO reading_history (title, content, source_url, word_count,
               new_words, comprehension_score, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (title, content, source_url, word_count, new_words, comprehension_score, now_iso())
        )
        await db.commit()
        return cursor.lastrowid
    finally:
        await db.close()


async def list_reading_history():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM reading_history ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_reading_history(record_id):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM reading_history WHERE id = ?", (record_id,))
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        await db.close()


# --- Speaking History CRUD ---

async def add_speaking_history(scenario, messages, score, feedback):
    import json
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO speaking_history (scenario, messages, score, feedback, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (scenario, json.dumps(messages, ensure_ascii=False), score, feedback, now_iso())
        )
        await db.commit()
        return cursor.lastrowid
    finally:
        await db.close()


async def list_speaking_history():
    import json
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM speaking_history ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            try:
                d["messages"] = json.loads(d["messages"])
            except (json.JSONDecodeError, TypeError):
                d["messages"] = []
            results.append(d)
        return results
    finally:
        await db.close()


# --- Listening History CRUD ---

async def add_listening_history(title, content, source_url="", duration_seconds=0, comprehension_score=0):
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO listening_history (title, content, source_url,
               duration_seconds, comprehension_score, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (title, content, source_url, duration_seconds, comprehension_score, now_iso())
        )
        await db.commit()
        return cursor.lastrowid
    finally:
        await db.close()


async def list_listening_history():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM listening_history ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_listening_history(record_id):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM listening_history WHERE id = ?", (record_id,))
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        await db.close()


async def update_listening_history(record_id, **fields):
    db = await get_db()
    try:
        allowed = {"title", "content", "source_url", "duration_seconds", "comprehension_score"}
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [record_id]
        cursor = await db.execute(
            f"UPDATE listening_history SET {set_clause} WHERE id = ?", values
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# --- Settings CRUD ---

async def get_setting(key, default=""):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        if row:
            return row["value"]
        return default
    finally:
        await db.close()


async def set_setting(key, value):
    db = await get_db()
    try:
        await db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, str(value))
        )
        await db.commit()
    finally:
        await db.close()


async def get_all_settings():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT key, value FROM settings")
        rows = await cursor.fetchall()
        return {row["key"]: row["value"] for row in rows}
    finally:
        await db.close()


# --- Daily Words CRUD ---

def _parse_json_field(value, default):
    """Safely parse a JSON-encoded TEXT column into a Python object."""
    import json
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError, ValueError):
        return default


async def get_daily_words(date_str):
    """Get all words for a date, ordered by sort_order."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM daily_words WHERE date = ? ORDER BY sort_order ASC, id ASC",
            (date_str,)
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["collocations"] = _parse_json_field(d.get("collocations"), [])
            results.append(d)
        return results
    finally:
        await db.close()


async def save_daily_words(date_str, words_list):
    """Save a list of word dicts for a date. Replaces any existing words for that date."""
    import json
    db = await get_db()
    try:
        # Remove existing words for this date so regeneration is idempotent
        await db.execute("DELETE FROM daily_words WHERE date = ?", (date_str,))
        for idx, w in enumerate(words_list):
            collocations = w.get("collocations", [])
            if not isinstance(collocations, str):
                collocations = json.dumps(collocations, ensure_ascii=False)
            await db.execute(
                """INSERT INTO daily_words
                   (date, word, phonetic, pos, definition, definition_cn, collocations,
                    example, example_cn, mnemonic, category, difficulty, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    date_str,
                    w.get("word", ""),
                    w.get("phonetic", ""),
                    w.get("pos", ""),
                    w.get("definition", ""),
                    w.get("definition_cn", ""),
                    collocations,
                    w.get("example", ""),
                    w.get("example_cn", ""),
                    w.get("mnemonic", ""),
                    w.get("category", ""),
                    int(w.get("difficulty", 3) or 3),
                    int(w.get("sort_order", idx) if w.get("sort_order") is not None else idx),
                )
            )
        await db.commit()
    finally:
        await db.close()


async def get_daily_progress(date_str):
    """Get progress record for a date, or None if it does not exist."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM daily_progress WHERE date = ?", (date_str,)
        )
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        await db.close()


async def save_daily_progress(date_str, data_dict):
    """Upsert a progress record for a date (date is UNIQUE)."""
    db = await get_db()
    try:
        # Start from existing record (if any) so partial updates merge correctly
        existing = await get_daily_progress(date_str)
        merged = {
            "words_generated": 0,
            "words_reviewed": 0,
            "quiz_score": 0,
            "quiz_total": 0,
            "completed": 0,
        }
        if existing:
            for k in merged:
                merged[k] = existing.get(k, merged[k])
        for k, v in data_dict.items():
            if k in merged and v is not None:
                merged[k] = v

        await db.execute(
            """INSERT OR REPLACE INTO daily_progress
               (date, words_generated, words_reviewed, quiz_score, quiz_total, completed, created_at)
               VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM daily_progress WHERE date = ?), datetime('now')))""",
            (
                date_str,
                int(merged["words_generated"] or 0),
                int(merged["words_reviewed"] or 0),
                int(merged["quiz_score"] or 0),
                int(merged["quiz_total"] or 0),
                int(merged["completed"] or 0),
                date_str,
            )
        )
        await db.commit()
        return await get_daily_progress(date_str)
    finally:
        await db.close()


async def save_daily_quiz(date_str, questions_list):
    """Save quiz questions for a date. Replaces any existing quiz for that date."""
    import json
    db = await get_db()
    try:
        await db.execute("DELETE FROM daily_quiz WHERE date = ?", (date_str,))
        for q in questions_list:
            options = q.get("options", [])
            if not isinstance(options, str):
                options = json.dumps(options, ensure_ascii=False)
            await db.execute(
                """INSERT INTO daily_quiz
                   (date, word, question_type, question, options, answer)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    date_str,
                    q.get("word", ""),
                    q.get("question_type", ""),
                    q.get("question", ""),
                    options,
                    int(q.get("answer", 0) or 0),
                )
            )
        await db.commit()
    finally:
        await db.close()


async def get_daily_quiz(date_str):
    """Get all quiz questions for a date."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM daily_quiz WHERE date = ? ORDER BY id ASC", (date_str,)
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["options"] = _parse_json_field(d.get("options"), [])
            results.append(d)
        return results
    finally:
        await db.close()


async def update_quiz_answer(quiz_id, user_answer, is_correct):
    """Update a quiz question with the user's answer and correctness."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "UPDATE daily_quiz SET user_answer = ?, is_correct = ? WHERE id = ?",
            (int(user_answer), int(1 if is_correct else 0), int(quiz_id))
        )
        await db.commit()
        if cursor.rowcount == 0:
            return None
        cur2 = await db.execute("SELECT * FROM daily_quiz WHERE id = ?", (int(quiz_id),))
        row = await cur2.fetchone()
        if row:
            d = dict(row)
            d["options"] = _parse_json_field(d.get("options"), [])
            return d
        return None
    finally:
        await db.close()


async def get_quiz_by_id(quiz_id):
    """Get a single quiz question by id."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM daily_quiz WHERE id = ?", (int(quiz_id),))
        row = await cursor.fetchone()
        if row:
            d = dict(row)
            d["options"] = _parse_json_field(d.get("options"), [])
            return d
        return None
    finally:
        await db.close()


async def get_daily_streak():
    """Calculate consecutive days (going backwards from today) with completed=1."""
    from datetime import date, timedelta
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT date, completed FROM daily_progress WHERE completed = 1"
        )
        rows = await cursor.fetchall()
        completed_dates = {row["date"] for row in rows}

        streak = 0
        current = date.today()
        # If today is not yet completed, start counting from yesterday so an
        # in-progress today does not break an existing streak.
        if current.isoformat() not in completed_dates:
            current = current - timedelta(days=1)
        while current.isoformat() in completed_dates:
            streak += 1
            current = current - timedelta(days=1)
        return streak
    finally:
        await db.close()


async def get_total_words_learned():
    """Count distinct words across all dates where words_reviewed > 0."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT COUNT(DISTINCT dw.word) AS cnt
               FROM daily_words dw
               JOIN daily_progress dp ON dp.date = dw.date
               WHERE dp.words_reviewed > 0"""
        )
        row = await cursor.fetchone()
        return row["cnt"] if row else 0
    finally:
        await db.close()


async def get_daily_history(page=1, page_size=7):
    """Get past days' summaries, most recent first, paginated."""
    db = await get_db()
    try:
        page = max(1, int(page))
        page_size = max(1, int(page_size))
        offset = (page - 1) * page_size

        cursor = await db.execute(
            """SELECT dp.date AS date,
                      (SELECT COUNT(*) FROM daily_words dw WHERE dw.date = dp.date) AS words_count,
                      dp.words_reviewed AS words_reviewed,
                      dp.quiz_score AS quiz_score,
                      dp.quiz_total AS quiz_total,
                      dp.completed AS completed
               FROM daily_progress dp
               ORDER BY dp.date DESC
               LIMIT ? OFFSET ?""",
            (page_size, offset)
        )
        rows = await cursor.fetchall()

        cur_total = await db.execute("SELECT COUNT(*) AS cnt FROM daily_progress")
        total = (await cur_total.fetchone())["cnt"]

        return {"days": [dict(r) for r in rows], "total": total, "page": page, "page_size": page_size}
    finally:
        await db.close()


async def get_daily_stats():
    """Aggregate learning statistics across all daily_progress records."""
    from datetime import date, timedelta
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM daily_progress")
        rows = [dict(r) for r in await cursor.fetchall()]

        total_days = len(rows)
        total_words = sum(r.get("words_reviewed", 0) or 0 for r in rows)

        scored = [r for r in rows if (r.get("quiz_total", 0) or 0) > 0]
        if scored:
            avg_score = sum(
                (r.get("quiz_score", 0) or 0) / (r.get("quiz_total", 0) or 1) * 100
                for r in scored
            ) / len(scored)
            avg_score = round(avg_score, 1)
        else:
            avg_score = 0

        # This week: last 7 days including today, oldest -> newest
        today = date.today()
        week_dates = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
        by_date = {r["date"]: r for r in rows}
        this_week = []
        for d in week_dates:
            r = by_date.get(d)
            this_week.append({
                "date": d,
                "words_reviewed": (r.get("words_reviewed", 0) if r else 0),
                "quiz_score": (r.get("quiz_score", 0) if r else 0),
                "quiz_total": (r.get("quiz_total", 0) if r else 0),
                "completed": (r.get("completed", 0) if r else 0),
            })

        return {
            "total_days": total_days,
            "total_words": total_words,
            "avg_score": avg_score,
            "this_week": this_week,
        }
    finally:
        await db.close()
