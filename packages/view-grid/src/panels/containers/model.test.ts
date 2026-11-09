import { describe, expect, test } from 'bun:test';
import { parseLogFiles, relativeIn, setLogFile, containerTone, isContainerName, isDockerDown, isMachineDown, parseDocker, parsePinned, parsePodman, sortPinned, togglePinned } from './model';

const podman = JSON.stringify([
  { Id: 'abcdef1234567890', Names: ['web'], Image: 'nginx', State: 'running', Status: 'Up 2 hours', Created: 1700000000, Ports: [{ host_port: 8080, container_port: 80 }, { host_port: 8080, container_port: 80 }] },
  { Id: '1234567890abcdef', Names: [], Image: 'redis', State: 'exited', Status: 'Exited (0)', Created: 1700000100 },
]);

const docker = [
  '{"ID":"aaa111","Names":"db","Image":"postgres","State":"running","Status":"Up 1 hour","Ports":"0.0.0.0:5432->5432/tcp, :::5432->5432/tcp","CreatedAt":"2026-01-02 10:00:00 +0000 UTC"}',
  '',
  '{"ID":"bbb2223334445","Names":"api","Image":"api:1","State":"exited","Status":"Exited (1)","CreatedAt":"bad"}',
].join('\n');

describe('containers model', () => {
  test('parsePodman', () => {
    const list = parsePodman(podman);
    expect(list[0]).toEqual({ id: 'abcdef1234567890', name: 'web', ports: '8080:80', image: 'nginx', state: 'running', status: 'Up 2 hours', created: 1700000000000 });
    expect(list[1]?.name).toBe('1234567890ab');
    expect(parsePodman('nope')).toEqual([]);
  });

  test('parseDocker', () => {
    const list = parseDocker(docker);
    expect(list.map((c) => c.name)).toEqual(['db', 'api']);
    expect(list[0]?.ports).toBe('5432:5432');
    expect(list[0]?.created).toBeGreaterThan(0);
    expect(list[1]?.created).toBe(0);
  });

  test('isMachineDown', () => {
    expect(isMachineDown('Cannot connect to Podman. Please verify')).toBe(true);
    expect(isMachineDown('unable to connect to Podman socket: x')).toBe(true);
    expect(isMachineDown('other')).toBe(false);
  });

  test('sortPinned', () => {
    const list = parsePodman(podman);
    const sorted = sortPinned(list, parsePinned('web\n\n'));
    expect(sorted[0]?.name).toBe('web');
    expect(sorted[0]?.pinned).toBe(true);
    expect(sortPinned(list, ['1234567890ab'])[0]?.name).toBe('1234567890ab');
  });

  test('isDockerDown', () => {
    expect(isDockerDown('Cannot connect to the Docker daemon at unix:///var/run/docker.sock')).toBe(true);
    expect(isDockerDown('error during connect: open //./pipe/docker_engine')).toBe(true);
    expect(isDockerDown('other')).toBe(false);
  });

  test('containerTone', () => {
    expect(containerTone({ state: 'running', status: 'Up 1 hour' })).toBe('ok');
    expect(containerTone({ state: 'running', status: 'Up 1 hour (unhealthy)' })).toBe('danger');
    expect(containerTone({ state: 'paused', status: 'Up (Paused)' })).toBe('warn');
    expect(containerTone({ state: 'exited', status: 'Exited (0) 1 hour ago' })).toBe('neutral');
    expect(containerTone({ state: 'exited', status: 'Exited (137) 1 hour ago' })).toBe('danger');
  });

  test('isContainerName', () => {
    expect(isContainerName('web_1.db-x')).toBe(true);
    expect(isContainerName('-rf')).toBe(false);
    expect(isContainerName('a b')).toBe(false);
  });

  test('togglePinned', () => {
    expect(togglePinned('web', 'db')).toBe('web\ndb');
    expect(togglePinned('web\ndb', 'web')).toBe('db');
  });

  test('relativeIn', () => {
    expect(relativeIn('X:\\Environments\\container', 'X:\\Environments\\container\\milesroot\\logs\\miles-debug.log')).toBe('milesroot/logs/miles-debug.log');
    expect(relativeIn('x:/environments/container/', 'X:\\Environments\\container\\a.log')).toBe('a.log');
    expect(relativeIn('X:\\Environments\\container', 'X:\\Environments\\container2\\a.log')).toBeNull();
    expect(relativeIn('/srv/app', '/srv/app/logs/a.log')).toBe('logs/a.log');
    expect(relativeIn('/srv/app', '/srv/App/a.log')).toBeNull();
  });

  test('log files', () => {
    const win = 'X:\\logs\\a=b.log';
    const text = setLogFile(setLogFile('', 'miles-core', win), 'db', '/var/log/db.log');
    expect(parseLogFiles(text)).toEqual({ 'miles-core': win, db: '/var/log/db.log' });
    expect(parseLogFiles(setLogFile(text, 'db', ' '))).toEqual({ 'miles-core': win });
    expect(parseLogFiles('-x=/a\nnoequals\n=p')).toEqual({});
  });
});
