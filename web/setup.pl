#!perl -w
use strict;
use warnings;
use File::Basename qw(dirname);
use Cwd            qw(abs_path);
use constant ROOT => abs_path(dirname(__FILE__));
use lib ROOT . "/extlib/lib/perl5";

my $root = ROOT;
my $cpanm = 'http://cpanmin.us/';

my @modules = qw(
    Plack
    File::Which
    String::ShellQuote
);

system("curl -L $cpanm | $^X - --notest '-l$root/extlib' @modules") == 0 or die "Cannot setup!";

