<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/*">
<xsl:apply-templates/>
</xsl:template>

<?ampp_ampptype?>
<xsl:template match="//AMPPS/AMPP">
<xsl:value-of select="APPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="INVALID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NM"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="ABBREVNM"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="VPPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="APID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="COMBPACKCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="LEGAL_CATCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="SUBP"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="DISCCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="DISCDT"/>
<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>
