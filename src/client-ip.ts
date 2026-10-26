export const CLIENT_IP_HEADER = "x-taimei-client-ip";

export const withClientIp = (request: Request, ip: string | null): Request => {
  const copy = new Request(request);
  if (ip === null) copy.headers.delete(CLIENT_IP_HEADER);
  else copy.headers.set(CLIENT_IP_HEADER, ip);
  return copy;
};
