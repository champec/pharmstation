<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/*">
<xsl:apply-templates/>
</xsl:template>

<xsl:template match="//DTINFO">
<xsl:value-of select="VPPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PAY_CATCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PRICE"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="DT"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PREVPRICE"/>


<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>
