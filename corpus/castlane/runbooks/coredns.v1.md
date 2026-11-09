---
id: runbooks/coredns.md@v1
source: runbooks
type: runbook
title: "DNS failures inside the cluster"
url: https://runbooks.castlane.internal/coredns/v1
service: [platform]
alerts: [KubePodNotReady]
allowed_groups: [eng, contractors]
author: hq
version: 1
effective_at: 2025-02-11
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-02-11T16:49:00Z
generated: true
---
# DNS failures inside the cluster

This runbook covers in-cluster DNS lookups failing in Kubernetes. It applies to prod and staging, usually in the `platform` space because the DNS path is shared by every service. Use it when pods report `no such host` or `i/o timeout` while resolving `*.svc.cluster.local`.

## Alerts that link here

- `KubePodNotReady`

## Diagnosis

1. Confirm the failure mode from the affected pod logs or readiness checks.

   Look for these strings:
   - `no such host`
   - `i/o timeout`
   - failed lookup for `*.svc.cluster.local`

   If the error is application level only, keep going. DNS can fail before any app-specific retry logic kicks in.

2. Check CoreDNS health in `kube-system`.

   ```bash
   kubectl --context prod-us-east -n kube-system get pods -l k8s-app=kube-dns -o wide
   kubectl --context prod-us-east -n kube-system get deploy coredns
   kubectl --context prod-us-east -n kube-system logs deploy/coredns --tail=200
   ```

   **Watch for** restarts, `CrashLoopBackOff`, or logs that show upstream timeout, SERVFAIL, or inability to reach the API server.

3. Check NodeLocal DNSCache if the cluster uses it.

   ```bash
   kubectl --context prod-us-east -n kube-system get ds nodelocaldns -o wide
   kubectl --context prod-us-east -n kube-system get pods -l k8s-app=node-local-dns -o wide
   kubectl --context prod-us-east -n kube-system logs ds/nodelocaldns --tail=200
   ```

   **If NodeLocal DNSCache is unhealthy on one node, only pods on that node may fail.** Compare the failing pod node with the NodeLocal DNSCache pod on the same node.

4. Test resolution from a debug pod in the same cluster and namespace.

   Use a temporary pod with DNS tools, then query a service name directly.

   ```bash
   kubectl --context prod-us-east -n media run dns-debug --rm -it --restart=Never --image=busybox:1.36 -- sh
   ```

   Inside the shell:

   ```sh
   cat /etc/resolv.conf
   nslookup kubernetes.default.svc.cluster.local
   nslookup upload-api.media.svc.cluster.local
   nslookup feed-builder.feeds.svc.cluster.local
   ```

   **If `kubernetes.default.svc.cluster.local` fails, treat this as cluster-wide DNS impact.** If only one service name fails, check the Service and Endpoints objects for that workload.

5. Check whether a node has a full conntrack table.

   This often shows up as intermittent timeouts, especially under load.

   ```bash
   kubectl --context prod-us-east get nodes
   kubectl --context prod-us-east debug node/<node-name> -it --image=busybox:1.36 -- chroot /host sh
   ```

   On the node shell:

   ```sh
   sysctl net.netfilter.nf_conntrack_count
   sysctl net.netfilter.nf_conntrack_max
   dmesg | tail -n 50
   ```

   **If `nf_conntrack_count` is close to `nf_conntrack_max`, DNS and other short UDP flows can fail.** Check whether the node is overloaded, and whether many pods on that node are opening new connections rapidly.

6. Confirm the DNS Service and endpoints still exist.

   ```bash
   kubectl --context prod-us-east -n kube-system get svc kube-dns
   kubectl --context prod-us-east -n kube-system get endpoints kube-dns
   kubectl --context prod-us-east -n kube-system describe svc kube-dns
   ```

   **If the Service has no endpoints, CoreDNS may be running but unreachable through the Service.**

## Mitigation

1. Restart CoreDNS one pod at a time.

   **Do not restart all CoreDNS pods at once.** One at a time is safe, and preserves DNS service during the rollout.

   ```bash
   kubectl --context prod-us-east -n kube-system rollout restart deploy/coredns
   kubectl --context prod-us-east -n kube-system rollout status deploy/coredns
   ```

   If the Deployment does not roll cleanly, delete one CoreDNS pod and wait for it to come back before touching the next one.

2. If NodeLocal DNSCache is the issue, restart only the broken daemon pod on the affected node.

   ```bash
   kubectl --context prod-us-east -n kube-system delete pod -l k8s-app=node-local-dns --field-selector spec.nodeName=<node-name>
   ```

   Re-test from the same node after the pod returns.

3. If conntrack is full on one node, drain or move work off that node.

   ```bash
   kubectl --context prod-us-east drain <node-name> --ignore-daemonsets --delete-emptydir-data
   ```

   Then watch the DNS error rate and pod readiness recover. If draining is too disruptive, coordinate with the owning service team to reschedule the hottest pods first.

4. Re-test DNS after each change.

   ```bash
   kubectl --context prod-us-east -n media run dns-debug --rm -it --restart=Never --image=busybox:1.36 -- sh
   ```

   ```sh
   nslookup upload-api.media.svc.cluster.local
   nslookup feed-builder.feeds.svc.cluster.local
   ```

## Escalation

- Escalate to `platform` if CoreDNS stays unhealthy after a one-pod-at-a-time restart.
- Escalate to the node owner if conntrack remains near the limit after draining or pod movement.
- Escalate to `#oncall` with the node name, namespace, and exact lookup failure.
- If the issue affects production write paths or multiple namespaces, open a ticket with prefix `PLAT-` and link the failing pod names and timestamps.

**If DNS is down broadly, treat this as a cluster health incident, not a single-service bug.**

## History

- 2025-02-11, version 1, initial runbook for in-cluster DNS failures, including CoreDNS, NodeLocal DNSCache, and conntrack checks.
- 2025-02-11, version 1, added debug pod `nslookup` flow and safe one-at-a-time CoreDNS restart guidance.
- 2025-02-11, version 1, clarified escalation path for cluster-wide lookup failures and node-specific timeouts.
