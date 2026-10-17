#!/usr/bin/env python3
"""Run by a LaunchAgent with a Sockets dict. Asks launchd for its sockets with launch_activate_socket(3).

  launchd_shim.py serve NAME...          serve a tiny HTTP response on each socket (proves the socket works)
  launchd_shim.py exec NAME... -- CMD... dup2 the sockets to fds 3, 4, ... and exec CMD (Caddy with `fd/3`, ...)
"""
import ctypes
import os
import socket
import sys
import threading

libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
libc.launch_activate_socket.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.POINTER(ctypes.c_int)),
                                        ctypes.POINTER(ctypes.c_size_t)]


def activate(name):
    fds = ctypes.POINTER(ctypes.c_int)()
    cnt = ctypes.c_size_t()
    err = libc.launch_activate_socket(name.encode(), ctypes.byref(fds), ctypes.byref(cnt))
    if err:
        print(f'launch_activate_socket({name}) failed: errno {err} {os.strerror(err)}', flush=True)
        return []
    out = [fds[i] for i in range(cnt.value)]
    print(f'launch_activate_socket({name}) -> fds {out}', flush=True)
    return out


def serve(fd, name):
    s = socket.socket(fileno=fd)
    print(f'{name}: fd {fd} bound to {s.getsockname()}', flush=True)
    while True:
        c, addr = s.accept()
        c.recv(4096)
        body = f'hello from launchd socket {name} {s.getsockname()} peer {addr}\n'.encode()
        c.sendall(b'HTTP/1.0 200 OK\r\nContent-Length: %d\r\n\r\n' % len(body) + body)
        c.close()


mode = sys.argv[1]
if mode == 'serve':
    threads = []
    for name in sys.argv[2:]:
        for fd in activate(name):
            t = threading.Thread(target=serve, args=(fd, name), daemon=True)
            t.start()
            threads.append(t)
    for t in threads:
        t.join()
elif mode == 'exec':
    sep = sys.argv.index('--')
    names, cmd = sys.argv[2:sep], sys.argv[sep + 1:]
    fds = [fd for name in names for fd in activate(name)]
    for i, fd in enumerate(fds):
        os.dup2(fd, 3 + i, inheritable=True)
    print(f'exec {cmd} with fds 3..{2 + len(fds)}', flush=True)
    os.execv(cmd[0], cmd)
