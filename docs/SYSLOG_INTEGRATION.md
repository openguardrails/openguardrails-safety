# SIEM / Syslog Integration Guide

OpenGuardrails can forward detection events to your SIEM system via syslog in real time. This document describes the configuration, field mapping, and message format.

## Overview

OpenGuardrails generates a detection event for every request processed by the guardrail engine. When syslog forwarding is enabled, each event is sent to your syslog collector in **CEF (Common Event Format)** over UDP, TCP, or TLS — in addition to the local JSONL log files (which are always written regardless of syslog configuration).

```
User Request
    |
    v
Guardrail Detection
    |
    +---> JSONL file  (always, detection_YYYYMMDD.jsonl)
    +---> Syslog/CEF  (when SYSLOG_HOST is configured)
    +---> Database     (when store_detection_results=true)
```

## Prerequisites

To enable syslog forwarding, your security team needs to provide:

| Item | Description | Example |
|------|-------------|---------|
| **Syslog server address** | Hostname or IP of the syslog collector | `siem.corp.example.com` |
| **Syslog server port** | Listening port | `514` (UDP), `6514` (TLS) |
| **Transport protocol** | UDP, TCP, or TLS | `UDP` |
| **TLS certificate** (if TLS) | CA certificate for TLS verification | `/etc/ssl/certs/siem-ca.pem` |
| **Facility** (optional) | Syslog facility code | `LOCAL0` (default) |

## Configuration

Set the following environment variables (or add to your `.env` file):

```bash
# Required - enables syslog forwarding
SYSLOG_HOST=siem.corp.example.com
SYSLOG_PORT=514

# Optional
SYSLOG_PROTOCOL=UDP          # UDP (default) | TCP | TLS
SYSLOG_FACILITY=LOCAL0        # Syslog facility (default: LOCAL0)
SYSLOG_CA_CERT=               # Path to CA cert file (required for TLS)
```

When `SYSLOG_HOST` is not set, syslog forwarding is completely disabled and the system behaves exactly as before.

## CEF Message Format

Each detection event is sent as a CEF-formatted syslog message:

```
CEF:0|OpenGuardrails|AI-Safety-Platform|{version}|detection|AI Content Detection|{severity}|{extensions}
```

### CEF Header Fields

| CEF Field | Value | Description |
|-----------|-------|-------------|
| Version | `0` | CEF format version |
| Device Vendor | `OpenGuardrails` | Fixed |
| Device Product | `AI-Safety-Platform` | Fixed |
| Device Version | `{app_version}` | OpenGuardrails version (e.g., `5.2.0`) |
| Signature ID | `detection` | Event type |
| Name | `AI Content Detection` | Event name |
| Severity | `0-10` | Mapped from risk level (see below) |

### Severity Mapping

| OpenGuardrails Risk Level | CEF Severity | Description |
|---------------------------|--------------|-------------|
| `no_risk` | `0` | No risk detected |
| `low` | `3` | Low risk |
| `medium` | `6` | Medium risk |
| `high` | `9` | High risk |
| `error` | `5` | Detection error |

The overall severity is the highest severity across security, compliance, and data risk dimensions.

### CEF Extension Fields

| CEF Key | Type | OpenGuardrails Field | Description |
|---------|------|----------------------|-------------|
| `externalId` | string | `request_id` | Unique request identifier |
| `rt` | timestamp | `created_at` | Event timestamp (epoch ms) |
| `src` | string | `ip_address` | Source IP address |
| `duid` | string | `tenant_id` | Tenant identifier |
| `cs1` | string | `application_id` | Application identifier |
| `cs1Label` | string | — | `"ApplicationId"` |
| `act` | string | `suggest_action` | Action taken: `pass`, `reject`, `replace` |
| `requestClientApplication` | string | `user_agent` | Client user agent |
| `cs2` | string | `security_risk_level` | Security risk level |
| `cs2Label` | string | — | `"SecurityRiskLevel"` |
| `cs3` | string | `security_categories` | Security risk categories (comma-separated) |
| `cs3Label` | string | — | `"SecurityCategories"` |
| `cs4` | string | `compliance_risk_level` | Compliance risk level |
| `cs4Label` | string | — | `"ComplianceRiskLevel"` |
| `cs5` | string | `compliance_categories` | Compliance risk categories (comma-separated) |
| `cs5Label` | string | — | `"ComplianceCategories"` |
| `cs6` | string | `data_risk_level` | Data leakage risk level |
| `cs6Label` | string | — | `"DataRiskLevel"` |
| `cs7` | string | `data_categories` | Data leakage categories (comma-separated) |
| `cs7Label` | string | — | `"DataCategories"` |
| `cn1` | float | `sensitivity_score` | Sensitivity score (0.0-1.0) |
| `cn1Label` | string | — | `"SensitivityScore"` |
| `cs8` | string | `matched_scanner_tags` | Matched scanner tags (comma-separated) |
| `cs8Label` | string | — | `"MatchedScannerTags"` |
| `cs9` | string | `hit_keywords` | Hit keywords (comma-separated) |
| `cs9Label` | string | — | `"HitKeywords"` |
| `msg` | string | `content` | Detected content (truncated to 1024 chars, sensitive entities masked) |
| `cn2` | int | `image_count` | Number of images in request |
| `cn2Label` | string | — | `"ImageCount"` |
| `cs10` | string | `source` | Detection source: `guardrail_api`, `proxy`, `gateway`, `direct_model`, `content_scan` |
| `cs10Label` | string | — | `"DetectionSource"` |

### Example CEF Message

```
CEF:0|OpenGuardrails|AI-Safety-Platform|5.2.0|detection|AI Content Detection|9|externalId=req_abc123 rt=1711234567000 src=192.168.1.100 duid=tenant_456 cs1=app_789 cs1Label=ApplicationId act=reject cs2=high cs2Label=SecurityRiskLevel cs3=S5 cs3Label=SecurityCategories cs4=no_risk cs4Label=ComplianceRiskLevel cs5= cs5Label=ComplianceCategories cs6=no_risk cs6Label=DataRiskLevel cs7= cs7Label=DataCategories cn1=0.95 cn1Label=SensitivityScore cs8=S5 cs8Label=MatchedScannerTags msg=User attempted prompt injection... cn2=0 cn2Label=ImageCount cs10=guardrail_api cs10Label=DetectionSource
```

## SIEM-Specific Notes

### Splunk
- Use the **Splunk Add-on for CEF** to parse incoming messages
- Set source type to `cef` for automatic field extraction

### Elastic / OpenSearch
- Use **Filebeat CEF module** or configure a syslog input with CEF processor
- Fields map directly to ECS (Elastic Common Schema) via the CEF module

### IBM QRadar
- CEF is natively supported; events auto-map to QRadar properties
- Custom properties can be created for `cs1`-`cs9` fields

### Microsoft Sentinel
- Use the **Common Event Format (CEF) via AMA** data connector
- Detection events appear in the `CommonSecurityLog` table

## Verification

After configuring syslog, verify events are being received:

```bash
# Check OpenGuardrails logs for syslog status
docker logs openguardrails-admin | grep -i syslog

# Send a test detection request
curl -X POST http://localhost:5001/v1/guardrails \
  -H "Authorization: Bearer sk-xxai-YOUR-KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "test message"}]}'

# Verify on your SIEM that the event arrived
```

## Troubleshooting

| Issue | Check |
|-------|-------|
| No events in SIEM | Verify `SYSLOG_HOST` and `SYSLOG_PORT` are set correctly |
| Connection refused | Check firewall rules between OpenGuardrails and syslog server |
| TLS handshake failure | Verify `SYSLOG_CA_CERT` path and certificate validity |
| Missing fields | Ensure your SIEM parser supports CEF format |

## Data Privacy

- The `msg` (content) field is **truncated to 1024 characters** to limit log volume
- Sensitive entities detected by data masking are **automatically masked** before logging (e.g., credit card numbers appear as `[CREDIT_CARD]`)
- If your policy requires no content in logs, contact support to configure content-free syslog events
