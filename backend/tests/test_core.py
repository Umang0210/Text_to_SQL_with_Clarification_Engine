from fastapi.testclient import TestClient

from app.main import app


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
