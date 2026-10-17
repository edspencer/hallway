#!/usr/bin/env python3
"""Does IP_BOUND_IF (lo0) on a wildcard listener stop connections arriving on another interface (macOS)?

  boundif.py serve   listeners on 0.0.0.0:8443 (IP_BOUND_IF lo0), 0.0.0.0:8444 (plain), 127.0.0.1:8445
  boundif.py probe   (root) SYN from 10.99.0.2 into feth1, so it arrives on feth0 (10.99.0.1); report the answer
"""
import socket
import sys
import time

IP_BOUND_IF = 25  # <netinet/in.h> on Darwin

if sys.argv[1] == 'serve':
    socks = []
    for host, port, bound in [('0.0.0.0', 8443, True), ('0.0.0.0', 8444, False), ('127.0.0.1', 8445, False)]:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if bound:
            s.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, socket.if_nametoindex('lo0'))
        s.bind((host, port))
        s.listen()
        socks.append(s)
    print('serving', flush=True)
    time.sleep(600)
else:
    from scapy.all import Ether, IP, TCP, srp1, get_if_hwaddr, conf  # noqa
    conf.verb = 0
    dst_mac = get_if_hwaddr('feth0')
    for port, what in [(8443, '0.0.0.0 + IP_BOUND_IF lo0'), (8444, '0.0.0.0 plain (control: should answer)'),
                       (8445, '127.0.0.1 (control: should not answer)')]:
        pkt = Ether(dst=dst_mac, src=get_if_hwaddr('feth1')) / IP(src='10.99.0.2', dst='10.99.0.1') / \
            TCP(sport=40000 + port % 1000, dport=port, flags='S', seq=1000)
        ans = srp1(pkt, iface='feth1', timeout=3)
        verdict = 'no answer' if ans is None else (ans[TCP].sprintf('%TCP.flags%') if TCP in ans else ans.summary())
        print(f'port {port} [{what}]: {verdict}', flush=True)
