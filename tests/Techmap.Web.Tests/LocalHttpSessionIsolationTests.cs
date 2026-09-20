using Microsoft.AspNetCore.Http;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class LocalHttpSessionIsolationTests
{
    [Fact]
    public void Two_local_servers_keep_both_sessions_in_the_shared_browser_cookie_jar()
    {
        var first = new LocalHttpSession();
        var second = new LocalHttpSession();
        var firstPage = new DefaultHttpContext();
        var secondPage = new DefaultHttpContext();
        first.IssueCookie(firstPage.Response, new PathString("/"));
        second.IssueCookie(secondPage.Response, new PathString("/"));
        var cookie1 = firstPage.Response.Headers.SetCookie.ToString().Split(';')[0];
        var cookie2 = secondPage.Response.Headers.SetCookie.ToString().Split(';')[0];
        var request = new DefaultHttpContext().Request;
        request.Headers.Cookie = $"{cookie1}; {cookie2}";
        Assert.NotEqual(first.InstanceCookieName, second.InstanceCookieName);
        Assert.True(first.HasValidCookie(request));
        Assert.True(second.HasValidCookie(request));
        request.Headers.Cookie = cookie2;
        Assert.False(first.HasValidCookie(request));
        Assert.True(second.HasValidCookie(request));
    }
}
