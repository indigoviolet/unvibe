A urllib3 response carries its headers twice. `r.headers` is urllib3's `HTTPHeaderDict`, a case-insensitive dict that keeps repeated headers. `r._original_response.msg` is the `HTTPMessage` that `http.client` built while parsing, based on Python's email message class. urllib3 builds the first from the second, but some libraries, notably Requests for cookies, read the second directly. Fixing only one would leave them disagreeing. [[diff:conn:650-651]]

::: simple
There are two copies of the headers: urllib3's own, and the one Python's HTTP library made. Other libraries read different copies, so both need the same clean values.
:::

::: deep
Two representations of one fact are a consistency hazard. The PR chooses to normalize the source, then derive: it rewrites the `HTTPMessage` in place (keeping the object's identity, defects and policy) and builds `HTTPHeaderDict` from the same normalized list, so both views are equal by construction.
:::

::: example
```
r = pool.request("GET", "/")
r.headers.getlist("set-cookie")                # urllib3's HTTPHeaderDict
r._original_response.msg.get_all("set-cookie") # http.client's HTTPMessage
# Requests' cookie jar reads the second one.
```
:::

```json
{
  "title": "HTTPHeaderDict and HTTPMessage",
  "anchor": {"quote": "copied those values straight into its", "host": "card:problem#b1"}
}
```
