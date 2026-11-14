from fastapi.testclient import TestClient

from app.main import app
from app.schema import execute_read_only


client = TestClient(app)


def test_health() -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_clarification_flow(tmp_path) -> None:
    database = tmp_path / "demo.db"
    import sqlite3
    connection = sqlite3.connect(database)
    connection.execute("CREATE TABLE orders (customer_id INTEGER, revenue REAL)")
    connection.execute("INSERT INTO orders VALUES (1, 100)")
    connection.commit()
    connection.close()
    created = client.post("/connections", json={"name": "demo", "url": f"sqlite:///{database}"}).json()
    conversation = client.post("/conversations", params={"connection_id": created["id"]}).json()
    response = client.post(f"/conversations/{conversation['id']}/messages", json={"content": "Show me the top customers"}).json()
    assert response["status"] == "clarification_required"
    response = client.post(f"/conversations/{conversation['id']}/clarifications", json={"metric": "Revenue", "time_range": "All time"}).json()
    assert response["status"] == "completed"
    assert response["rows"][0]["revenue"] == 100


def test_csv_upload_and_query() -> None:
    csv_data = b"customer_id,city,booking_status,fare\n1,Delhi,completed,100\n2,Mumbai,cancelled,50\n1,Delhi,completed,80\n"
    response = client.post("/datasets/upload", files={"file": ("cab_bookings.csv", csv_data, "text/csv")})
    assert response.status_code == 200
    dataset = response.json()
    assert dataset["tables"][0]["row_count"] == 3
    assert len(dataset["preview"]) == 3
    connection = client.post("/conversations", params={"connection_id": dataset["connection_id"]}).json()
    result = client.post(f"/conversations/{connection['id']}/messages", json={"content": "Show the total number of bookings"}).json()
    assert result["status"] == "completed"
    assert result["rows"][0]["total_count"] == 3


def test_six_consecutive_queries_share_one_sqlite_dataset(tmp_path) -> None:
    import sqlite3

    database = tmp_path / "cab_bookings.db"
    connection = sqlite3.connect(database)
    connection.execute(
        """
        CREATE TABLE bookings (
          city TEXT, customer_name TEXT, revenue REAL, booking_date TEXT,
          fare REAL, payment_method TEXT, driver_id TEXT
        )
        """
    )
    connection.executemany(
        "INSERT INTO bookings VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            ("Delhi", "Asha", 500, "2025-01-03", 100, "Cash", "D1"),
            ("Delhi", "Asha", 400, "2025-01-12", 80, "UPI", "D1"),
            ("Delhi", "Ravi", 175, "2025-01-20", 60, "Card", "D3"),
            ("Mumbai", "Ravi", 450, "2025-01-15", 150, "Card", "D2"),
            ("Mumbai", "Mina", 125, "2025-02-02", 50, "UPI", "D2"),
            ("Pune", "Mina", 225, "2025-02-14", 75, "Cash", "D3"),
        ],
    )
    connection.commit()
    connection.close()

    url = f"sqlite:///{database}"
    queries = [
        'SELECT city, COUNT(*) AS booking_count FROM bookings GROUP BY city ORDER BY booking_count DESC',
        'SELECT customer_name, SUM(revenue) AS revenue FROM bookings GROUP BY customer_name ORDER BY revenue DESC LIMIT 5',
        "SELECT strftime('%Y-%m', booking_date) AS month, SUM(revenue) AS revenue FROM bookings GROUP BY month ORDER BY month",
        'SELECT city, AVG(fare) AS average_fare FROM bookings GROUP BY city ORDER BY city',
        'SELECT payment_method, COUNT(*) AS booking_count FROM bookings GROUP BY payment_method ORDER BY booking_count DESC',
        'SELECT driver_id, COUNT(*) AS completed_rides FROM bookings GROUP BY driver_id ORDER BY completed_rides DESC',
    ]

    results = [execute_read_only(url, query, 500) for query in queries]

    assert [len(rows) for _, rows in results] == [3, 3, 2, 3, 3, 3]
    assert results[0][1][0]["city"] == "Delhi"
    assert results[1][1][0]["customer_name"] == "Asha"
    assert results[2][1][0]["month"] == "2025-01"
