function beijingTime() {
    var now = new Date();
    var beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return beijing.getUTCFullYear() + "-" +
        p(beijing.getUTCMonth() + 1) + "-" +
        p(beijing.getUTCDate()) + " " +
        p(beijing.getUTCHours()) + ":" +
        p(beijing.getUTCMinutes()) + ":" +
        p(beijing.getUTCSeconds());
}

module.exports = {
    beijingTime: beijingTime
};
