# Grafana Setup for WavePilotAI

This directory contains the configuration to run Grafana for visualizing InfluxDB data.

## 1. Local Development
Run Grafana locally using Docker Compose without needing to install anything else.

### Start
```bash
cd devtools/grafana
docker compose up -d
```
- Access UI: `http://localhost:3300`
- Default User: `admin`
- Default Password: `admin`

### Configuration
- **Datasources**: Configured manually in UI to avoid committing sensitive tokens.
- **Connection**:
    - **URL**: `https://<endpoint>.timestream-influxdb.us-west-2.on.aws:8181`

---

## 2. Remote Deployment (EC2 in AWS)
For better performance and direct VPC access, Grafana works best on an EC2 instance in the same VPC as InfluxDB.

### Setup on EC2
1.  **Copy Files**: Copy `docker-compose.yml` to the EC2 instance.
2.  **Start Service**:
    ```bash
    docker compose up -d
    ```

### Accessing Remote Grafana (SSH Tunnel)
To securely access the Grafana UI on the EC2 instance without exposing port 3300 to the public internet:

```bash
# Forward local port 3300 to EC2 port 3300
ssh -f -N -L 3300:localhost:3300 -i <key.pem> ubuntu@<EC2-Public-IP>
```
- Then open `http://localhost:3300` in your browser.

---

## 3. Troubleshooting
- **Login Failed**: If `admin/admin` fails, reset it:
  ```bash
  docker exec -it wavepilot-grafana grafana-cli admin reset-admin-password admin
  ```
- **"Connection Error" / "Unexpected EOF"**:
  - Usually means Grafana connects to a hostname that doesn't match the SSL certificate (`host.docker.internal` vs AWS URL).
  - **Fix**: In Grafana Datasource settings, enable `Skip TLS Verify` or ensure you are using the correct AWS Hostname + DNS aliasing.
