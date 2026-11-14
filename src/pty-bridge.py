#!/usr/bin/env python3
"""
CMC PTY Bridge
Provides a true pseudo-terminal (PTY) for interactive bash sessions.
Communicates with Node.js via stdin/stdout.
Supports resize commands via \\x01COLS,ROWS\\n prefix.
"""

import os
import sys
import pty
import select
import termios
import struct
import fcntl
import signal

def set_winsize(fd, rows, cols):
    try:
        r = max(1, int(rows))
        c = max(1, int(cols))
        winsize = struct.pack("HHHH", r, c, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except Exception:
        pass

def main():
    cols = 80
    rows = 24
    if len(sys.argv) > 2:
        try:
            cols = int(sys.argv[1])
            rows = int(sys.argv[2])
        except Exception:
            pass

    master, slave = pty.openpty()
    set_winsize(master, rows, cols)

    pid = os.fork()
    if pid == 0:
        # Child process: attach to slave PTY
        os.close(master)
        os.setsid()
        try:
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        except Exception:
            pass
        for fd in (0, 1, 2):
            os.dup2(slave, fd)
        if slave > 2:
            os.close(slave)

        try:
            os.tcsetpgrp(0, os.getpid())
        except Exception:
            pass

        # Prefer bash for stable web terminal PTY interaction without capability probe hangs
        shell = os.environ.get("CMC_SHELL")
        if not shell:
            for candidate in ["/bin/bash", "/usr/bin/bash", os.environ.get("SHELL"), "/bin/sh"]:
                if candidate and os.path.exists(candidate):
                    shell = candidate
                    break
        if not shell:
            shell = "/bin/sh"
        home = os.environ.get("HOME", "/home/muhamad")
        try:
            os.chdir(home)
        except Exception:
            pass

        os.environ["TERM"] = "xterm-256color"
        os.environ["COLORTERM"] = "truecolor"
        try:
            os.execv(shell, [shell, "-i"])
        except Exception:
            os.execv("/bin/sh", ["/bin/sh"])
    else:
        # Parent bridge process
        os.close(slave)

        # Non-blocking stdin
        fl = fcntl.fcntl(sys.stdin.fileno(), fcntl.F_GETFL)
        fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, fl | os.O_NONBLOCK)

        in_buf = bytearray()

        try:
            while True:
                rlist, _, _ = select.select([sys.stdin.fileno(), master], [], [])

                # From Node (browser stdin) -> PTY master
                if sys.stdin.fileno() in rlist:
                    try:
                        chunk = os.read(sys.stdin.fileno(), 4096)
                        if not chunk:
                            break
                        in_buf.extend(chunk)

                        # Check for resize command: \x01COLS,ROWS\n
                        while True:
                            idx = in_buf.find(b"\n")
                            if idx == -1:
                                break
                            line = in_buf[:idx]
                            if line.startswith(b"\x01"):
                                del in_buf[:idx + 1]
                                try:
                                    dims = line[1:].decode("utf-8", "ignore").strip().split(",")
                                    if len(dims) == 2:
                                        new_cols, new_rows = int(dims[0]), int(dims[1])
                                        set_winsize(master, new_rows, new_cols)
                                        os.kill(pid, signal.SIGWINCH)
                                except Exception:
                                    pass
                            else:
                                break

                        # Flush remaining buffer to master
                        if in_buf:
                            if in_buf.startswith(b"\x01") and b"\n" not in in_buf:
                                pass
                            else:
                                os.write(master, bytes(in_buf))
                                in_buf.clear()
                    except (BlockingIOError, InterruptedError):
                        pass
                    except OSError:
                        break

                # From PTY master -> Node (browser stdout)
                if master in rlist:
                    try:
                        out = os.read(master, 4096)
                        if not out:
                            break
                        sys.stdout.buffer.write(out)
                        sys.stdout.buffer.flush()
                    except OSError:
                        break
        finally:
            try:
                os.close(master)
            except Exception:
                pass
            try:
                os.kill(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
            except Exception:
                pass

if __name__ == "__main__":
    main()
