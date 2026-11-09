---
id: runbooks/certificates.md@v2
source: runbooks
type: runbook
title: "Certificates: ingress and edge"
url: https://runbooks.castlane.internal/certificates/v2
service: [cdn-edge, platform]
alerts: [KubeClientCertificateExpiration]
allowed_groups: [eng, contractors]
author: yu
version: 2
effective_at: 2025-10-21
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-10-21T13:24:00Z
generated: true
---
# Certificates: ingress and edge

This runbook covers TLS certificates issued by cert-manager for ingress and edge workloads in the `cdn-edge` and `platform` areas. cert-manager renews certificates about 30 days before expiry, so most work here is checking why a renewal stalled and getting it unstuck before clients see an expired cert. The owner team is `edge`, with help from `platform` for cluster-level issuer or controller problems.

## Alerts that link here

- `KubeClientCertificateExpiration`

## Diagnosis

1. Confirm which certificate is expiring and where it lives.

   ```bash
   kubectl get certificate -A
   ```

   Look for certificates with an age close to the renewal window, or a `READY` status that is not `True`. If you are triaging a page from Alertmanager, compare the namespace and certificate name with the alert labels in Grafana.

2. Inspect the certificate object for events and renewal state.

   ```bash
   kubectl describe certificate -n <namespace> <certificate-name>
   ```

   Check for:
   - `Not After` date
   - `Renewal Time`
   - recent warnings under `Events`
   - references to the `Issuer` or `ClusterIssuer`

   A normal screenshot in Grafana or `kubectl describe` should show the certificate near its renewal time, then a clean chain of `Issuing certificate as Secret does not exist` or `Re-issuing certificate as renewal was requested` messages. If you see repeated failures with the same timestamp, that usually means cert-manager is retrying and not making progress.

3. Inspect the related CertificateRequest objects.

   ```bash
   kubectl get certificaterequest -n <namespace>
   kubectl describe certificaterequest -n <namespace> <request-name>
   ```

   A failed renewal usually leaves a CertificateRequest behind. Check:
   - `Approved` and `Denied` conditions
   - issuer reference
   - event messages from the controller
   - whether the request is stuck waiting on the issuer

   If the request is approved but never completes, the issuer path is the most likely problem. In the 2025-10 incident, the renewal controller was healthy, but issuer rate limits delayed new issuance long enough to push certificates close to expiry.

4. Check cert-manager controller logs for issuer throttling or API errors.

   ```bash
   kubectl -n cert-manager logs deploy/cert-manager --since=2h | grep -E 'rate|issuer|renew|certificate|request'
   ```

   You are looking for messages about failed issuance, backoff, or HTTP/API throttling from the issuer integration. If logs are sparse, widen the time window to `--since=6h`.

5. If you need a cluster-wide view, check for other affected certificates.

   ```bash
   kubectl get certificate -A | grep -v 'True'
   ```

   This helps determine whether the problem is isolated to one ingress or whether multiple edge certificates are waiting on the same issuer path.

## Mitigation

1. If the certificate is close to expiry and cert-manager has not retried successfully, trigger a manual renewal.

   ```bash
   cmctl renew -n <namespace> <certificate-name>
   ```

   Then watch the request and certificate objects again:

   ```bash
   kubectl get certificaterequest -n <namespace> -w
   kubectl get certificate -n <namespace> <certificate-name> -w
   ```

2. If the renewal still stalls, confirm whether the issuer is rate limiting.

   - Look for repeated failure events on the CertificateRequest.
   - Check whether multiple certificates are being renewed at the same time.
   - If this is a broad issuer issue, avoid hammering renewals in a loop.

3. If the certificate is already expired and the edge service is affected, coordinate a controlled rollback or temporary traffic shift through the normal deployment path.

   ```bash
   kubectl -n edge rollout status deploy/cdn-edge
   ```

   If the service cannot present a valid cert, check the ingress controller and the active secret name before making any change. A healthy state should show the certificate secret updated and the ingress serving the new chain.

4. If the manual renewal succeeded, verify the secret and the serving side.

   ```bash
   kubectl get secret -n <namespace> <tls-secret-name> -o yaml
   ```

   Then confirm the ingress or edge endpoint presents the new certificate from the client side.

## Useful checks

| Check | Command |
| --- | --- |
| List all certs | `kubectl get certificate -A` |
| Inspect one cert | `kubectl describe certificate -n <ns> <name>` |
| Inspect request | `kubectl describe certificaterequest -n <ns> <request-name>` |
| Force renewal | `cmctl renew -n <ns> <name>` |
| Watch status | `kubectl get certificate -n <ns> <name> -w` |

## Escalation

- Escalate to `platform` if multiple certificates are failing renewal, if cert-manager is unhealthy, or if the issuer appears rate limited across namespaces.
- Escalate to `edge` if the active ingress certificate is expired or is within hours of expiry and manual renewal does not complete.
- Use `#oncall` for coordination, and `#platform` or `#edge` for live debugging, depending on where the failure sits.
- If the issuer is external to Castlane and the problem looks provider-side, open a ticket and include the CertificateRequest name, namespace, timestamps, and the exact event output from `kubectl describe`.

## History

- 2025-10-21, version 2, added explicit manual renewal steps with `cmctl renew` and clarified how to spot issuer rate limiting from CertificateRequest events.
- 2025-09-18, version 1, documented the standard cert-manager renewal path for ingress and edge certificates, including `kubectl get certificate -A` and `kubectl describe certificaterequest`.
- 2025-10-08, version 0, initial runbook draft after the 2025-10 renewal delay incident, when issuer throttling slowed several edge certificate renewals.
